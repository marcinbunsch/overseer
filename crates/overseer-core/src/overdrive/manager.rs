//! The Overdrive manager: manual "run next" trigger + the opt-in scheduler.
//!
//! Holds the single-flight guard (one run globally) and the interval loop. The
//! scheduler is **off by default** — [`OverdriveManager::tick`] no-ops until the
//! user enables it in config. The manual [`OverdriveManager::run_next`] is the
//! primary trigger.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;

use crate::config::read_app_config;
use crate::context::OverseerContext;
use crate::git::worktree::archive_workspace;
use crate::persistence::types::TaskStatus;
use crate::persistence::{find_project, list_tasks, load_project_registry, upsert_task};

use super::engine::{execute_run, RunBudgets, RunParams};
use super::run::{get_run, list_runs, upsert_run, OverdriveRun, RunStatus};

/// Coordinates Overdrive runs: single-flight guard + interval scheduler.
pub struct OverdriveManager {
    ctx: Arc<OverseerContext>,
    /// The task id of the run currently in flight, if any (global single-flight).
    in_flight: Arc<Mutex<Option<String>>>,
}

impl OverdriveManager {
    pub fn new(ctx: Arc<OverseerContext>) -> Self {
        Self {
            ctx,
            in_flight: Arc::new(Mutex::new(None)),
        }
    }

    /// True if a run is currently in flight.
    pub fn is_in_flight(&self) -> bool {
        self.in_flight.lock().unwrap().is_some()
    }

    /// Start a run for the top `Todo` task of `repo`, if any and if no run is in
    /// flight. Returns the started task id, or `None` when there is no work.
    ///
    /// Must be called from within a tokio runtime (it spawns the run).
    pub fn run_next(&self, repo: &str) -> Result<Option<String>, String> {
        // Reserve the single-flight slot atomically to avoid a double-start race.
        {
            let mut guard = self.in_flight.lock().unwrap();
            if guard.is_some() {
                return Err("a run is already in flight".to_string());
            }
            *guard = Some(String::new()); // placeholder reservation
        }

        // From here, any early return must release the reservation.
        let result = self.prepare_and_spawn(repo);
        if !matches!(result, Ok(Some(_))) {
            *self.in_flight.lock().unwrap() = None;
        }
        result
    }

    /// Load task + settings, mark the task running, and spawn `execute_run`.
    fn prepare_and_spawn(&self, repo: &str) -> Result<Option<String>, String> {
        let config_dir = self.ctx.config_dir().ok_or("config directory not set")?;

        let task = match list_tasks(&config_dir, repo)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|t| t.status == TaskStatus::Todo)
        {
            Some(t) => t,
            None => return Ok(None),
        };

        let (repo_path, instructions, check_command) = repo_settings(&config_dir, repo)
            .ok_or_else(|| format!("repo not found in registry: {repo}"))?;

        let cfg = read_app_config(&config_dir);

        // Mark the task Running so it isn't picked again.
        let mut running = task.clone();
        running.status = TaskStatus::Running;
        upsert_task(&config_dir, repo, running).map_err(|e| e.to_string())?;

        // Record the real task id in the reserved slot.
        *self.in_flight.lock().unwrap() = Some(task.id.clone());

        let params = RunParams {
            task: task.clone(),
            repo_path,
            project_name: repo.to_string(),
            agent_path: cfg.resolved_claude_path(),
            model: cfg.default_claude_model.clone(),
            agent_shell: cfg.resolved_agent_shell(),
            check_command,
            overdrive_instructions: instructions,
            budgets: RunBudgets::default(),
        };

        let ctx = Arc::clone(&self.ctx);
        let in_flight = Arc::clone(&self.in_flight);
        let repo_owned = repo.to_string();
        let task_id = task.id.clone();

        tokio::spawn(async move {
            let run = execute_run(&ctx, params).await;
            // Reflect the outcome on the task and link the run, then free the slot.
            if let Some(dir) = ctx.config_dir() {
                if let Ok(tasks) = list_tasks(&dir, &repo_owned) {
                    if let Some(mut t) = tasks.into_iter().find(|t| t.id == task_id) {
                        t.status = task_status_for_run(run.status);
                        t.run_ids.push(run.id.clone());
                        let _ = upsert_task(&dir, &repo_owned, t);
                    }
                }
            }
            *in_flight.lock().unwrap() = None;
        });

        Ok(Some(task.id))
    }

    /// Approve a `NeedsReview` run: mark it complete (run `Approved`, task
    /// `Done`). Does **not** merge — the branch and workspace are left as-is so
    /// the user can merge on their own terms via the normal workspace flow.
    pub async fn approve_run(&self, run_id: &str) -> Result<(), String> {
        let config_dir = self.ctx.config_dir().ok_or("config directory not set")?;
        let mut run = get_run(&config_dir, run_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        if run.status != RunStatus::NeedsReview {
            return Err("run is not awaiting review".to_string());
        }
        let (name, _path, _main_branch) =
            resolve_project(&config_dir, &run.repo_id).ok_or("repo not found in registry")?;

        run.status = RunStatus::Approved;
        run.ended_at = Some(Utc::now());
        upsert_run(&config_dir, run.clone()).map_err(|e| e.to_string())?;
        set_task_status(&config_dir, &name, &run.task_id, TaskStatus::Done);
        self.emit_status(&run);
        Ok(())
    }

    /// Reject a run: archive its workspace (worktree removed, branch kept).
    pub async fn reject_run(&self, run_id: &str) -> Result<(), String> {
        let config_dir = self.ctx.config_dir().ok_or("config directory not set")?;
        let mut run = get_run(&config_dir, run_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        let workspace = run.workspace_path.clone().ok_or("run has no workspace")?;
        let (name, path, _mb) =
            resolve_project(&config_dir, &run.repo_id).ok_or("repo not found in registry")?;

        archive_workspace(Path::new(&path), Path::new(&workspace))
            .await
            .map_err(|e| e.to_string())?;

        // Drop the workspace out of the repo tree (worktree is gone).
        if let Some(ws_id) = &run.workspace_id {
            archive_workspace_in_registry(&config_dir, &run.repo_id, ws_id);
        }

        run.status = RunStatus::Rejected;
        run.ended_at = Some(Utc::now());
        upsert_run(&config_dir, run.clone()).map_err(|e| e.to_string())?;
        set_task_status(&config_dir, &name, &run.task_id, TaskStatus::Rejected);
        self.emit_status(&run);
        Ok(())
    }

    /// Ensure a run's worktree is registered as a workspace and its chat is
    /// indexed, so it can be opened for review. Idempotent — a no-op for runs
    /// registered at provisioning, a backfill for older runs. Returns the
    /// workspace id.
    pub fn ensure_workspace(&self, run_id: &str) -> Result<Option<String>, String> {
        let config_dir = self.ctx.config_dir().ok_or("config directory not set")?;
        let mut run = get_run(&config_dir, run_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("run not found: {run_id}"))?;
        let workspace_path = run.workspace_path.clone().ok_or("run has no workspace")?;
        let (name, _path, _mb) =
            resolve_project(&config_dir, &run.repo_id).ok_or("repo not found in registry")?;
        let workspace_name = Path::new(&workspace_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or("invalid workspace path")?;
        let chat_label = task_title(&config_dir, &name, &run.task_id)
            .or_else(|| run.branch.clone())
            .unwrap_or_else(|| "Overdrive run".to_string());

        let ws_id = super::engine::register_run_workspace(
            &self.ctx,
            &config_dir,
            &run.repo_id,
            &name,
            &workspace_name,
            &workspace_path,
            run.branch.as_deref().unwrap_or(""),
            run_id,
            &chat_label,
        );
        if let Some(id) = &ws_id {
            if run.workspace_id.as_deref() != Some(id.as_str()) {
                run.workspace_id = Some(id.clone());
                let _ = upsert_run(&config_dir, run);
            }
        }
        Ok(ws_id)
    }

    /// Emit an `overdrive:run-status` event for a run.
    fn emit_status(&self, run: &OverdriveRun) {
        self.ctx.event_bus.emit(
            "overdrive:run-status",
            &serde_json::json!({
                "id": run.id,
                "taskId": run.task_id,
                "repoId": run.repo_id,
                "status": run.status,
            }),
        );
    }

    /// One scheduler tick: start a run if enabled, eligible, and within budget.
    async fn tick(&self) {
        let config_dir = match self.ctx.config_dir() {
            Some(d) => d,
            None => return,
        };
        let cfg = read_app_config(&config_dir).overdrive;
        if !cfg.scheduler_enabled {
            return;
        }

        let needs_review = list_runs(&config_dir)
            .map(|runs| {
                runs.iter()
                    .filter(|r| r.status == RunStatus::NeedsReview)
                    .count() as u32
            })
            .unwrap_or(0);

        let window = RunWindow {
            start: cfg.run_window_start.as_deref().and_then(parse_hm),
            end: cfg.run_window_end.as_deref().and_then(parse_hm),
        };
        if !scheduler_should_run(
            self.is_in_flight(),
            needs_review,
            cfg.backpressure_cap,
            local_now_minutes(),
            &window,
        ) {
            return;
        }

        // Round-robin the Overdrive-enabled repos; start the first with a Todo.
        let registry = match load_project_registry(&config_dir) {
            Ok(r) => r,
            Err(_) => return,
        };
        for project in registry.projects {
            if project.overdrive_enabled != Some(true) {
                continue;
            }
            if let Ok(Some(_)) = self.run_next(&project.name) {
                break;
            }
        }
    }

    /// Run the scheduler loop forever. Re-reads config each tick, so enabling the
    /// scheduler in settings takes effect without a restart. Cheap while off.
    pub async fn run_scheduler(self: Arc<Self>) {
        // Fixed base cadence; the tick itself gates on the configured interval by
        // reading `scheduler_enabled` (off by default → no-op).
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        loop {
            ticker.tick().await;
            self.tick().await;
        }
    }
}

/// (repo_path, overdrive_instructions, overdrive_check_command) for a repo name.
fn repo_settings(
    config_dir: &std::path::Path,
    repo: &str,
) -> Option<(String, Option<String>, Option<String>)> {
    let registry = load_project_registry(config_dir).ok()?;
    let project = registry.projects.into_iter().find(|p| p.name == repo)?;
    Some((
        project.path,
        project.overdrive_instructions,
        project.overdrive_check_command,
    ))
}

/// (name, path, main_branch) for a project resolved by id.
fn resolve_project(
    config_dir: &Path,
    project_id: &str,
) -> Option<(String, String, Option<String>)> {
    let registry = load_project_registry(config_dir).ok()?;
    let p = find_project(&registry, project_id)?;
    Some((p.name.clone(), p.path.clone(), p.main_branch.clone()))
}

/// Mark a workspace archived in projects.json (no-op if not found).
fn archive_workspace_in_registry(config_dir: &Path, project_id: &str, workspace_id: &str) {
    if let Ok(mut registry) = load_project_registry(config_dir) {
        if let Some(project) = registry.projects.iter_mut().find(|p| p.id == project_id) {
            if let Some(ws) = project.workspaces.iter_mut().find(|w| w.id == workspace_id) {
                ws.is_archived = true;
                let _ = crate::persistence::save_project_registry(config_dir, &registry);
            }
        }
    }
}

/// A task's title by id (for labelling the run's chat).
fn task_title(config_dir: &Path, repo: &str, task_id: &str) -> Option<String> {
    list_tasks(config_dir, repo)
        .ok()?
        .into_iter()
        .find(|t| t.id == task_id)
        .map(|t| t.title)
}

/// Set a task's status by id (no-op if the task is gone).
fn set_task_status(config_dir: &Path, repo: &str, task_id: &str, status: TaskStatus) {
    if let Ok(tasks) = list_tasks(config_dir, repo) {
        if let Some(mut t) = tasks.into_iter().find(|t| t.id == task_id) {
            t.status = status;
            let _ = upsert_task(config_dir, repo, t);
        }
    }
}

/// Map a finished run's status onto the task's status.
fn task_status_for_run(status: RunStatus) -> TaskStatus {
    match status {
        RunStatus::NeedsReview => TaskStatus::NeedsReview,
        RunStatus::Approved => TaskStatus::Done,
        RunStatus::Rejected => TaskStatus::Rejected,
        // Failed, NeedsInput, Interrupted, or any mid-state left on exit.
        _ => TaskStatus::Failed,
    }
}

// ============================================================================
// PURE SCHEDULER HELPERS (unit-tested)
// ============================================================================

/// A run window in minutes-since-local-midnight. `None` bound = open-ended.
#[derive(Debug, Clone, Copy, Default)]
pub struct RunWindow {
    pub start: Option<u32>,
    pub end: Option<u32>,
}

/// Whether the scheduler may start a run right now.
pub fn scheduler_should_run(
    in_flight: bool,
    needs_review_count: u32,
    backpressure_cap: u32,
    now_minutes: u32,
    window: &RunWindow,
) -> bool {
    if in_flight {
        return false;
    }
    if needs_review_count >= backpressure_cap {
        return false;
    }
    within_window(now_minutes, window)
}

/// Whether `now` falls inside the window (handles a window that wraps midnight).
fn within_window(now: u32, window: &RunWindow) -> bool {
    match (window.start, window.end) {
        (None, None) => true,
        (Some(s), None) => now >= s,
        (None, Some(e)) => now < e,
        (Some(s), Some(e)) if s <= e => now >= s && now < e,
        (Some(s), Some(e)) => now >= s || now < e, // wraps past midnight
    }
}

/// Parse "HH:MM" into minutes since midnight.
fn parse_hm(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    if h < 24 && m < 60 {
        Some(h * 60 + m)
    } else {
        None
    }
}

/// Minutes since local midnight, right now.
fn local_now_minutes() -> u32 {
    use chrono::Timelike;
    let now = chrono::Local::now();
    now.hour() * 60 + now.minute()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(start: Option<u32>, end: Option<u32>) -> RunWindow {
        RunWindow { start, end }
    }

    #[test]
    fn parse_hm_valid_and_invalid() {
        assert_eq!(parse_hm("22:00"), Some(22 * 60));
        assert_eq!(parse_hm("07:30"), Some(7 * 60 + 30));
        assert_eq!(parse_hm("24:00"), None);
        assert_eq!(parse_hm("nope"), None);
    }

    #[test]
    fn blocked_when_in_flight() {
        assert!(!scheduler_should_run(true, 0, 3, 600, &win(None, None)));
    }

    #[test]
    fn blocked_by_backpressure() {
        assert!(!scheduler_should_run(false, 3, 3, 600, &win(None, None)));
        assert!(scheduler_should_run(false, 2, 3, 600, &win(None, None)));
    }

    #[test]
    fn no_window_always_allowed() {
        assert!(scheduler_should_run(false, 0, 3, 0, &win(None, None)));
        assert!(scheduler_should_run(false, 0, 3, 1439, &win(None, None)));
    }

    #[test]
    fn same_day_window() {
        // 09:00–17:00
        let w = win(Some(9 * 60), Some(17 * 60));
        assert!(!scheduler_should_run(false, 0, 3, 8 * 60, &w));
        assert!(scheduler_should_run(false, 0, 3, 12 * 60, &w));
        assert!(!scheduler_should_run(false, 0, 3, 17 * 60, &w));
    }

    #[test]
    fn overnight_window_wraps_midnight() {
        // 22:00–07:00
        let w = win(Some(22 * 60), Some(7 * 60));
        assert!(scheduler_should_run(false, 0, 3, 23 * 60, &w)); // 23:00 inside
        assert!(scheduler_should_run(false, 0, 3, 2 * 60, &w)); // 02:00 inside
        assert!(!scheduler_should_run(false, 0, 3, 12 * 60, &w)); // noon outside
    }

    #[test]
    fn task_status_mapping() {
        assert_eq!(
            task_status_for_run(RunStatus::NeedsReview),
            TaskStatus::NeedsReview
        );
        assert_eq!(task_status_for_run(RunStatus::Failed), TaskStatus::Failed);
        assert_eq!(
            task_status_for_run(RunStatus::NeedsInput),
            TaskStatus::Failed
        );
        assert_eq!(task_status_for_run(RunStatus::Approved), TaskStatus::Done);
    }

    #[tokio::test]
    async fn run_next_no_config_dir_errors() {
        let ctx = Arc::new(OverseerContext::builder().build());
        let mgr = OverdriveManager::new(ctx);
        // No config dir set → error, and the slot is released.
        assert!(mgr.run_next("repo").is_err());
        assert!(!mgr.is_in_flight());
    }

    #[tokio::test]
    async fn approve_run_not_found_errors() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Arc::new(
            OverseerContext::builder()
                .config_dir(dir.path().to_path_buf())
                .build(),
        );
        let mgr = OverdriveManager::new(ctx);
        assert!(mgr.approve_run("nope").await.is_err());
    }

    #[tokio::test]
    async fn approve_run_wrong_status_errors() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Arc::new(
            OverseerContext::builder()
                .config_dir(dir.path().to_path_buf())
                .build(),
        );
        let mut run = OverdriveRun::new("r1".into(), "t1".into(), "repo-id".into());
        run.status = RunStatus::Failed;
        upsert_run(dir.path(), run).unwrap();

        let mgr = OverdriveManager::new(ctx);
        let err = mgr.approve_run("r1").await.unwrap_err();
        assert!(err.contains("not awaiting review"), "got: {err}");
    }

    #[test]
    fn ensure_workspace_backfills_and_is_idempotent() {
        use crate::persistence::types::{Project, ProjectRegistry};

        let dir = tempfile::tempdir().unwrap();
        let project = Project {
            id: "repo-id".into(),
            name: "myrepo".into(),
            path: "/repo".into(),
            is_git_repo: true,
            workspaces: vec![],
            worktrees: vec![],
            init_prompt: None,
            pr_prompt: None,
            post_create: None,
            workspace_filter: None,
            worktree_filter: None,
            use_github: None,
            allow_merge_to_main: None,
            main_branch: None,
            overdrive_enabled: None,
            overdrive_instructions: None,
            overdrive_check_command: None,
        };
        crate::persistence::save_project_registry(
            dir.path(),
            &ProjectRegistry {
                projects: vec![project],
            },
        )
        .unwrap();

        let mut run = OverdriveRun::new("r1".into(), "t1".into(), "repo-id".into());
        run.workspace_path = Some("/repo/narwhal".into());
        run.branch = Some("overdrive/x".into());
        upsert_run(dir.path(), run).unwrap();

        let ctx = Arc::new(
            OverseerContext::builder()
                .config_dir(dir.path().to_path_buf())
                .build(),
        );
        let mgr = OverdriveManager::new(ctx);

        let id1 = mgr.ensure_workspace("r1").unwrap();
        assert!(id1.is_some());

        let count = |dir: &std::path::Path| {
            load_project_registry(dir).unwrap().projects[0]
                .workspaces
                .len()
        };
        assert_eq!(count(dir.path()), 1);

        // Second call reuses the same workspace (idempotent, no duplicate).
        let id2 = mgr.ensure_workspace("r1").unwrap();
        assert_eq!(id1, id2);
        assert_eq!(count(dir.path()), 1);
    }

    #[tokio::test]
    async fn reject_run_not_found_errors() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Arc::new(
            OverseerContext::builder()
                .config_dir(dir.path().to_path_buf())
                .build(),
        );
        let mgr = OverdriveManager::new(ctx);
        assert!(mgr.reject_run("nope").await.is_err());
    }

    #[tokio::test]
    async fn run_next_empty_ledger_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Arc::new(
            OverseerContext::builder()
                .config_dir(dir.path().to_path_buf())
                .build(),
        );
        let mgr = OverdriveManager::new(ctx);
        // No tasks → Ok(None), slot released.
        assert!(matches!(mgr.run_next("repo"), Ok(None)));
        assert!(!mgr.is_in_flight());
    }
}
