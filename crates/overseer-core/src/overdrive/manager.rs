//! The Overdrive manager: manual "run next" trigger + the opt-in scheduler.
//!
//! Holds the single-flight guard (one run globally) and the interval loop. The
//! scheduler is **off by default** — [`OverdriveManager::tick`] no-ops until the
//! user enables it in config. The manual [`OverdriveManager::run_next`] is the
//! primary trigger.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::config::read_app_config;
use crate::context::OverseerContext;
use crate::persistence::types::TaskStatus;
use crate::persistence::{list_tasks, load_project_registry, upsert_task};

use super::engine::{execute_run, RunBudgets, RunParams};
use super::run::{list_runs, RunStatus};

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
