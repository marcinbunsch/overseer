//! The Overdrive run orchestrator.
//!
//! [`execute_run`] drives a task through the full lifecycle with no frontend
//! attached: provision a worktree, get the agent to register a machine-checkable
//! harness, prove it fails (red check), run the impl→review loop with fresh
//! context per iteration, then re-run the harness plus the repo check (final
//! verify) before landing at `needs-review`. The engine observes exit codes —
//! the agent never gets to declare success.
//!
//! The pure decision logic lives in [`super::run`]; this module is the
//! side-effecting glue (spawning agents, running commands, writing files,
//! persisting the run record, emitting status events).

use std::path::Path;
use std::time::{Duration, Instant};

use chrono::Utc;
use uuid::Uuid;

use super::harness::{diff_harness, run_check, snapshot_harness, CheckResult, HarnessSnapshot};
use super::log::RunLogger;
use super::run::{
    decide_after_final_verify, decide_after_red_check, harness_from_actions, result_from_actions,
    upsert_run, FinalDecision, OverdriveRun, RedCheckDecision, RunResult, RunStatus,
    VerificationEvidence, RUN_COMPLETE_MARKER,
};
use super::{run_turn, TurnOutcome, TurnParams};
use crate::context::OverseerContext;
use crate::overseer_actions::extract_overseer_blocks;
use crate::persistence::types::OverdriveTask;

/// Per-run budgets. Defaults mirror the design doc.
#[derive(Debug, Clone)]
pub struct RunBudgets {
    /// Cap on impl→review iterations in the working loop.
    pub max_iterations: u32,
    /// Overall wall-clock cap for the run.
    pub wall_clock: Duration,
    /// Per-turn wall-clock cap.
    pub per_turn: Duration,
    /// Per harness command timeout.
    pub per_command: Duration,
    /// Final-verify → working bounce cap.
    pub verify_bounce_cap: u32,
    /// Harness-phase attempt cap.
    pub harness_cap: u32,
}

impl Default for RunBudgets {
    fn default() -> Self {
        Self {
            max_iterations: 8,
            wall_clock: Duration::from_secs(30 * 60),
            per_turn: Duration::from_secs(10 * 60),
            per_command: Duration::from_secs(10 * 60),
            verify_bounce_cap: 2,
            harness_cap: 2,
        }
    }
}

/// Everything a run needs. The scheduler (Phase 5) fills these from config +
/// per-repo settings; the example binary fills them from CLI args.
pub struct RunParams {
    pub task: OverdriveTask,
    /// Path to the repo (base checkout) the worktree is created from.
    pub repo_path: String,
    /// Project name (chat persistence dir).
    pub project_name: String,
    /// Path to the `claude` binary (or `"claude"` to resolve via PATH).
    pub agent_path: String,
    pub model: Option<String>,
    pub agent_shell: Option<String>,
    /// Repo's standard check command run during final verify (e.g. "pnpm test").
    pub check_command: Option<String>,
    /// Per-repo Overdrive instructions injected into the worker prompts.
    pub overdrive_instructions: Option<String>,
    pub budgets: RunBudgets,
}

/// Drive a task to `needs-review` (or an off-ramp). Returns the final run record;
/// it is also persisted to `overdrive-runs.json` and streamed over the event bus
/// at every transition.
pub async fn execute_run(ctx: &OverseerContext, params: RunParams) -> OverdriveRun {
    let config_dir = match ctx.config_dir() {
        Some(d) => d,
        None => {
            let mut run = OverdriveRun::new(
                Uuid::new_v4().to_string(),
                params.task.id.clone(),
                params.task.repo_id.clone(),
            );
            fail(&mut run, "config directory not set".to_string());
            return run;
        }
    };

    let run_id = Uuid::new_v4().to_string();
    let mut run = OverdriveRun::new(
        run_id.clone(),
        params.task.id.clone(),
        params.task.repo_id.clone(),
    );
    run.chat_id = Some(run_id.clone());
    let start = Instant::now();

    let logger = RunLogger::open(
        Some(&config_dir),
        &params.project_name,
        &run_id,
        run.started_at,
    );
    logger.line(format!(
        "run {run_id} — task {:?} (repo {})",
        params.task.title, params.task.repo_id
    ));

    // --- Provisioning ---
    let branch = branch_name(&params.task);
    run.branch = Some(branch.clone());
    persist_and_emit(ctx, &config_dir, &logger, &run);

    let workspace_path =
        match crate::git::worktree::add_workspace(Path::new(&params.repo_path), &branch).await {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(e) => {
                fail(&mut run, format!("failed to provision workspace: {e}"));
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
        };
    run.workspace_path = Some(workspace_path.clone());
    let workspace_name = Path::new(&workspace_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "overdrive".to_string());

    // Keep Overdrive's memory files out of the repo (untracked + ignored) so the
    // agent never commits them and they don't clutter the review. Best-effort.
    let _ =
        crate::git::worktree::ignore_paths_in_worktree(Path::new(&workspace_path), &MEMORY_FILES)
            .await;

    if let Err(e) = write_memory_files(Path::new(&workspace_path), &params) {
        fail(&mut run, format!("failed to write memory files: {e}"));
        persist_and_emit(ctx, &config_dir, &logger, &run);
        return run;
    }

    // Register the worktree as an Overseer workspace + index the run's chat, so
    // the user can select it and review the driving conversation + diff in the
    // normal three-pane flow. Best-effort — a failure here doesn't fail the run.
    run.workspace_id = register_run_workspace(
        ctx,
        &config_dir,
        &params.task.repo_id,
        &params.project_name,
        &workspace_name,
        &workspace_path,
        &branch,
        &run_id,
        &params.task.title,
    );

    // Helper closure inputs shared by every turn. The agent logs its raw
    // conversation to the same file as this run's engine log.
    let drive = TurnDriver {
        ctx,
        chat_id: &run_id,
        project_name: &params.project_name,
        workspace_name: &workspace_name,
        working_dir: &workspace_path,
        agent_path: &params.agent_path,
        model: &params.model,
        chat_label: &params.task.title,
        log_target: logger.agent_target(),
        per_turn: params.budgets.per_turn,
    };

    // --- Harness phase + red check (interleaved, capped) ---
    set_status(&mut run, RunStatus::Harness);
    persist_and_emit(ctx, &config_dir, &logger, &run);

    let expect_green = params.task.expect_green_harness;
    let mut harness_attempt: u32 = 0;
    let mut retry_reason: Option<String> = None;

    let (commands, files, red_check, before_snapshot) = loop {
        if over_budget(start, params.budgets.wall_clock) {
            fail(&mut run, "wall-clock budget exceeded".to_string());
            persist_and_emit(ctx, &config_dir, &logger, &run);
            return run;
        }
        harness_attempt += 1;

        let prompt = match &retry_reason {
            Some(reason) => harness_retry_prompt(reason),
            None => harness_prompt(&params.task, params.overdrive_instructions.as_deref()),
        };
        match drive.turn(&prompt).await {
            TurnOutcome::Completed { text } => {
                let (_, actions) = extract_overseer_blocks(&text);
                let (commands, files) = match harness_from_actions(&actions) {
                    Some(v) => v,
                    None => {
                        if harness_attempt >= params.budgets.harness_cap {
                            fail(&mut run, "no verification registered".to_string());
                            persist_and_emit(ctx, &config_dir, &logger, &run);
                            return run;
                        }
                        retry_reason = Some(
                            "You did not emit a set_verification block. Register the harness now."
                                .to_string(),
                        );
                        continue;
                    }
                };

                logger.line(format!(
                    "harness registered: commands={commands:?} files={files:?}"
                ));
                set_status(&mut run, RunStatus::RedCheck);
                persist_and_emit(ctx, &config_dir, &logger, &run);

                let before = snapshot_harness(Path::new(&workspace_path), &files);
                let red = run_check(
                    &commands,
                    &workspace_path,
                    params.agent_shell.as_deref(),
                    params.budgets.per_command,
                )
                .await;
                log_check(&logger, "red check", &red);

                match decide_after_red_check(
                    &red,
                    expect_green,
                    harness_attempt - 1,
                    params.budgets.harness_cap,
                ) {
                    RedCheckDecision::Proceed => break (commands, files, red, before),
                    RedCheckDecision::BounceHarness => {
                        retry_reason = Some(
                            "Your harness passes before any work exists, so it proves nothing. \
                             Make it actually test the change (it must fail now)."
                                .to_string(),
                        );
                        set_status(&mut run, RunStatus::Harness);
                        persist_and_emit(ctx, &config_dir, &logger, &run);
                        continue;
                    }
                    RedCheckDecision::Fail => {
                        fail(&mut run, "harness stayed green before any work".to_string());
                        persist_and_emit(ctx, &config_dir, &logger, &run);
                        return run;
                    }
                }
            }
            TurnOutcome::NeedsInput { question } => {
                needs_input(&mut run, question);
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
            TurnOutcome::Failed { reason } => {
                fail(&mut run, format!("harness phase failed: {reason}"));
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
            TurnOutcome::TimedOut => {
                fail(&mut run, "harness phase timed out".to_string());
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
        }
    };

    // --- Working loop + final verify (final-verify bounces reopen the loop) ---
    set_status(&mut run, RunStatus::Working);
    persist_and_emit(ctx, &config_dir, &logger, &run);

    let mut verify_bounces: u32 = 0;
    let mut total_iterations: u32 = 0;
    let mut last_result: Option<RunResult> = None;

    let final_check: CheckResult = loop {
        // Run impl→review iterations until the review signals completion.
        let mut completed = false;
        while total_iterations < params.budgets.max_iterations {
            if over_budget(start, params.budgets.wall_clock) {
                fail(&mut run, "wall-clock budget exceeded".to_string());
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
            total_iterations += 1;
            run.iterations_used = total_iterations;
            logger.line(format!("iteration {total_iterations}: implementation"));

            // Implementation phase.
            match drive
                .turn(&impl_prompt(
                    total_iterations,
                    params.budgets.max_iterations,
                ))
                .await
            {
                TurnOutcome::Completed { .. } => {}
                TurnOutcome::NeedsInput { question } => {
                    needs_input(&mut run, question);
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
                TurnOutcome::Failed { reason } => {
                    fail(&mut run, format!("implementation failed: {reason}"));
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
                TurnOutcome::TimedOut => {
                    fail(&mut run, "implementation timed out".to_string());
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
            }

            // Review phase.
            logger.line(format!("iteration {total_iterations}: review"));
            let review_text = match drive
                .turn(&review_prompt(
                    total_iterations,
                    params.budgets.max_iterations,
                ))
                .await
            {
                TurnOutcome::Completed { text } => text,
                TurnOutcome::NeedsInput { question } => {
                    needs_input(&mut run, question);
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
                TurnOutcome::Failed { reason } => {
                    fail(&mut run, format!("review failed: {reason}"));
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
                TurnOutcome::TimedOut => {
                    fail(&mut run, "review timed out".to_string());
                    persist_and_emit(ctx, &config_dir, &logger, &run);
                    return run;
                }
            };

            let (_, actions) = extract_overseer_blocks(&review_text);
            if let Some(r) = result_from_actions(&actions) {
                last_result = Some(r);
            }
            if review_text.contains(RUN_COMPLETE_MARKER) {
                completed = true;
                break;
            }
        }

        if !completed {
            fail(
                &mut run,
                "iteration budget exhausted without completion".to_string(),
            );
            persist_and_emit(ctx, &config_dir, &logger, &run);
            return run;
        }

        // Final verify: registered commands + the repo's standard check.
        set_status(&mut run, RunStatus::FinalVerify);
        persist_and_emit(ctx, &config_dir, &logger, &run);

        let mut final_cmds = commands.clone();
        if let Some(cc) = params.check_command.as_ref() {
            if !cc.trim().is_empty() {
                final_cmds.push(cc.clone());
            }
        }
        let check = run_check(
            &final_cmds,
            &workspace_path,
            params.agent_shell.as_deref(),
            params.budgets.per_command,
        )
        .await;
        log_check(&logger, "final verify", &check);

        match decide_after_final_verify(&check, verify_bounces, params.budgets.verify_bounce_cap) {
            FinalDecision::Done => break check,
            FinalDecision::BounceWorking => {
                verify_bounces += 1;
                run.verify_bounces = verify_bounces;
                set_status(&mut run, RunStatus::Working);
                persist_and_emit(ctx, &config_dir, &logger, &run);
                continue;
            }
            FinalDecision::Fail => {
                run.verification = Some(build_evidence(
                    &commands,
                    &files,
                    Some(red_check.clone()),
                    Some(check),
                    &before_snapshot,
                    Path::new(&workspace_path),
                ));
                fail(&mut run, "final verify kept failing".to_string());
                persist_and_emit(ctx, &config_dir, &logger, &run);
                return run;
            }
        }
    };

    // --- Needs review ---
    run.verification = Some(build_evidence(
        &commands,
        &files,
        Some(red_check),
        Some(final_check),
        &before_snapshot,
        Path::new(&workspace_path),
    ));
    run.result = last_result;
    set_status(&mut run, RunStatus::NeedsReview);
    persist_and_emit(ctx, &config_dir, &logger, &run);
    run
}

/// Bundle of per-turn inputs so each `drive.turn(prompt)` call stays terse.
struct TurnDriver<'a> {
    ctx: &'a OverseerContext,
    chat_id: &'a str,
    project_name: &'a str,
    workspace_name: &'a str,
    working_dir: &'a str,
    agent_path: &'a str,
    model: &'a Option<String>,
    /// Chat label (task title) written to the chat metadata.
    chat_label: &'a str,
    /// (log_dir, log_id) so the agent's raw conversation lands in the run log.
    log_target: Option<(String, String)>,
    per_turn: Duration,
}

impl TurnDriver<'_> {
    async fn turn(&self, prompt: &str) -> TurnOutcome {
        // Force a fresh process (no --resume) so each iteration starts with clean
        // context; state carries only through the memory files.
        self.ctx.claude_agents.stop(self.chat_id);
        let (log_dir, log_id) = match &self.log_target {
            Some((d, i)) => (Some(d.clone()), Some(i.clone())),
            None => (None, None),
        };
        run_turn(
            self.ctx,
            TurnParams {
                conversation_id: self.chat_id.to_string(),
                project_name: self.project_name.to_string(),
                workspace_name: self.workspace_name.to_string(),
                working_dir: self.working_dir.to_string(),
                agent_path: self.agent_path.to_string(),
                prompt: prompt.to_string(),
                model: self.model.clone(),
                session_id: None,
                chat_label: Some(self.chat_label.to_string()),
                log_dir,
                log_id,
                timeout: self.per_turn,
            },
        )
        .await
    }
}

/// Register the run's worktree as an Overseer workspace and index its chat, so
/// the workspace is selectable and the chat shows up. Idempotent: if a workspace
/// with the same path already exists it is reused (so this doubles as a backfill
/// for pre-existing runs). Best-effort; returns the workspace id on success.
#[allow(clippy::too_many_arguments)]
pub(crate) fn register_run_workspace(
    ctx: &OverseerContext,
    config_dir: &Path,
    project_id: &str,
    project_name: &str,
    workspace_name: &str,
    workspace_path: &str,
    branch: &str,
    chat_id: &str,
    chat_label: &str,
) -> Option<String> {
    use crate::persistence::types::{ChatIndexEntry, Workspace};

    // 1. Add the worktree as a Workspace in projects.json (reuse if present).
    let mut registry = crate::persistence::load_project_registry(config_dir).ok()?;
    let project = registry.projects.iter_mut().find(|p| p.id == project_id)?;
    let workspace_id = match project.workspaces.iter().find(|w| w.path == workspace_path) {
        Some(existing) => existing.id.clone(),
        None => {
            let workspace_id = Uuid::new_v4().to_string();
            project.workspaces.push(Workspace {
                id: workspace_id.clone(),
                project_id: Some(project_id.to_string()),
                repo_id: None,
                branch: branch.to_string(),
                path: workspace_path.to_string(),
                is_archived: false,
                created_at: Utc::now(),
                pr_number: None,
                pr_url: None,
                pr_state: None,
                is_creating: None,
                is_archiving: None,
                ssh_host_id: None,
            });
            crate::persistence::save_project_registry(config_dir, &registry).ok()?;
            workspace_id
        }
    };

    // 2. Add the run's chat to the workspace's chat index.
    if let Some(chat_dir) = ctx.get_chat_dir(project_name, workspace_name) {
        if let Ok(mut index) = crate::persistence::index::load_chat_index(&chat_dir) {
            let now = Utc::now();
            crate::persistence::index::upsert_chat_entry(
                &mut index,
                ChatIndexEntry {
                    id: chat_id.to_string(),
                    label: chat_label.to_string(),
                    agent_type: Some("claude".to_string()),
                    created_at: now,
                    updated_at: now,
                    is_archived: None,
                    archived_at: None,
                },
            );
            let _ = crate::persistence::index::save_chat_index(&chat_dir, &index);
        }
    }

    Some(workspace_id)
}

fn over_budget(start: Instant, cap: Duration) -> bool {
    start.elapsed() > cap
}

fn set_status(run: &mut OverdriveRun, status: RunStatus) {
    run.status = status;
}

fn fail(run: &mut OverdriveRun, reason: String) {
    run.status = RunStatus::Failed;
    run.error = Some(reason);
    run.ended_at = Some(Utc::now());
}

fn needs_input(run: &mut OverdriveRun, question: String) {
    run.status = RunStatus::NeedsInput;
    run.error = Some(format!("blocked on input: {question}"));
    run.ended_at = Some(Utc::now());
}

/// Log a check's outcome plus per-command exit codes to the run log.
fn log_check(logger: &RunLogger, label: &str, check: &CheckResult) {
    logger.line(format!(
        "{label}: {}",
        if check.passed { "green" } else { "red" }
    ));
    for c in &check.commands {
        logger.line(format!(
            "  exit {} ({}ms){} — {}",
            c.exit_code,
            c.duration_ms,
            if c.timed_out { " TIMED OUT" } else { "" },
            c.command,
        ));
    }
}

fn build_evidence(
    commands: &[String],
    files: &[String],
    red_check: Option<CheckResult>,
    final_check: Option<CheckResult>,
    before: &HarnessSnapshot,
    workspace: &Path,
) -> VerificationEvidence {
    let after = snapshot_harness(workspace, files);
    VerificationEvidence {
        commands: commands.to_vec(),
        files: files.to_vec(),
        red_check,
        final_check,
        harness_drift: diff_harness(before, &after),
    }
}

fn persist_and_emit(
    ctx: &OverseerContext,
    config_dir: &Path,
    logger: &RunLogger,
    run: &OverdriveRun,
) {
    match &run.error {
        Some(err) => logger.line(format!("status → {:?} ({err})", run.status)),
        None => logger.line(format!("status → {:?}", run.status)),
    }
    if let Err(e) = upsert_run(config_dir, run.clone()) {
        log::warn!("Failed to persist Overdrive run {}: {}", run.id, e);
    }
    ctx.event_bus.emit(
        "overdrive:run-status",
        &serde_json::json!({
            "id": run.id,
            "taskId": run.task_id,
            "repoId": run.repo_id,
            "status": run.status,
        }),
    );
}

/// A git-safe branch name for the run.
fn branch_name(task: &OverdriveTask) -> String {
    let slug: String = task
        .title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() {
        "task".to_string()
    } else {
        slug
    };
    let short = &task.id.replace('-', "")[..task.id.replace('-', "").len().min(8)];
    format!("overdrive/{slug}-{short}")
}

/// The Overdrive memory files written into (and excluded from) the workspace.
const MEMORY_FILES: [&str; 3] = [
    "overdrive-prompt.md",
    "overdrive-progress.md",
    "overdrive-review.md",
];

fn write_memory_files(workspace: &Path, params: &RunParams) -> std::io::Result<()> {
    std::fs::write(
        workspace.join(MEMORY_FILES[0]),
        prompt_file_content(&params.task, params.overdrive_instructions.as_deref()),
    )?;
    std::fs::write(
        workspace.join(MEMORY_FILES[1]),
        "# Progress\n\nNo progress yet.\n",
    )?;
    std::fs::write(
        workspace.join(MEMORY_FILES[2]),
        "# Review\n\nNo review yet.\n",
    )?;
    Ok(())
}

// ============================================================================
// PROMPT TEMPLATES  (pure; unit-tested)
// ============================================================================

fn prompt_file_content(task: &OverdriveTask, instructions: Option<&str>) -> String {
    let mut s = format!("# Task: {}\n\n{}\n", task.title, task.description);
    if let Some(v) = task.verification.as_deref() {
        if !v.trim().is_empty() {
            s.push_str(&format!("\n## Verification criteria\n\n{v}\n"));
        }
    }
    if let Some(i) = instructions {
        if !i.trim().is_empty() {
            s.push_str(&format!("\n## Repo Overdrive instructions\n\n{i}\n"));
        }
    }
    s
}

fn harness_prompt(task: &OverdriveTask, instructions: Option<&str>) -> String {
    let criteria = match task.verification.as_deref() {
        Some(v) if !v.trim().is_empty() => format!("Honor these user criteria:\n{v}\n\n"),
        _ => String::new(),
    };
    let extra = match instructions {
        Some(i) if !i.trim().is_empty() => format!("\nRepo instructions:\n{i}\n"),
        _ => String::new(),
    };
    format!(
        "You are the Overdrive worker, in the HARNESS phase.\n\n\
         Read `overdrive-prompt.md` for the task.\n\n{criteria}\
         Before writing any implementation, decide how success for THIS task is machine-checkable \
         (a unit test, functional test, or script), build that harness, and register it by emitting \
         exactly one overseer block:\n\n\
         ```overseer\n\
         {{\"action\": \"set_verification\", \"params\": {{\"commands\": [\"<cmd>\"], \"files\": [\"<harness file>\"]}}}}\n\
         ```\n\n\
         The commands' exit codes define success. `files` lists the harness files you wrote (so the \
         engine can detect tampering). The harness MUST fail right now, because the change does not \
         exist yet. Do not implement the task in this phase. Record your reasoning in \
         `overdrive-progress.md`.{extra}"
    )
}

fn harness_retry_prompt(reason: &str) -> String {
    format!(
        "Your harness registration was rejected: {reason}\n\n\
         Re-register a correct harness by emitting a single set_verification overseer block whose \
         commands fail now (before the work exists) and whose `files` list the harness files."
    )
}

fn impl_prompt(iteration: u32, max: u32) -> String {
    format!(
        "You are the Overdrive worker, IMPLEMENTATION iteration {iteration} of max {max}.\n\n\
         - Read `overdrive-prompt.md` (the task) and `overdrive-progress.md` (what's done).\n\
         - Each iteration starts fresh — the progress file is your only memory.\n\
         - Do the next concrete step toward making the registered harness pass.\n\
         - Do NOT weaken, skip, or delete the harness/tests.\n\
         - Commit your work with git.\n\
         - Update `overdrive-progress.md` with what you did.\n\
         - Do NOT signal completion — a separate review step decides that."
    )
}

fn review_prompt(iteration: u32, max: u32) -> String {
    format!(
        "You are the Overdrive worker, REVIEW step after iteration {iteration} of max {max}.\n\n\
         - Read `overdrive-prompt.md` and `overdrive-progress.md`.\n\
         - Review the work against the goal for correctness and completeness.\n\
         - HARNESS INTEGRITY: check the diff for gamed verification — deleted or weakened \
         assertions, `expect(true)`, skipped tests, or edits to the registered harness. If you find \
         any, the task is NOT done; write it up in `overdrive-review.md`.\n\
         - Write your findings to `overdrive-review.md` and update `overdrive-progress.md`.\n\
         - Ensure the work is committed with git.\n\n\
         Decision:\n\
         - If the goal is fully and correctly done and the harness is honest, emit a report and the \
         completion marker:\n\n\
         ```overseer\n\
         {{\"action\": \"report_result\", \"params\": {{\"summary\": \"<what you did>\", \"assumptions\": []}}}}\n\
         ```\n\n\
         then end your response with exactly: {RUN_COMPLETE_MARKER}\n\
         - Otherwise describe what remains in `overdrive-review.md` and do NOT output the marker."
    )
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn task() -> OverdriveTask {
        OverdriveTask {
            id: "abc-123-def".into(),
            repo_id: "repo".into(),
            title: "Add a Foo endpoint!".into(),
            description: "It should return bar".into(),
            verification: Some("GET /foo returns 200".into()),
            expect_green_harness: false,
            status: Default::default(),
            order: 0,
            created_at: Utc::now(),
            run_ids: vec![],
            source_ref: None,
        }
    }

    #[test]
    fn branch_name_is_git_safe_and_slugged() {
        let b = branch_name(&task());
        assert!(b.starts_with("overdrive/add-a-foo-endpoint-"));
        assert!(!b.contains(' '));
        assert!(!b.contains('!'));
        assert!(!b.ends_with('-'));
    }

    #[test]
    fn prompt_file_includes_task_and_criteria() {
        let content = prompt_file_content(&task(), Some("no new deps"));
        assert!(content.contains("Add a Foo endpoint!"));
        assert!(content.contains("It should return bar"));
        assert!(content.contains("GET /foo returns 200"));
        assert!(content.contains("no new deps"));
    }

    #[test]
    fn harness_prompt_asks_for_set_verification_and_red() {
        let p = harness_prompt(&task(), None);
        assert!(p.contains("set_verification"));
        assert!(p.contains("MUST fail"));
        assert!(p.contains("files"));
    }

    #[test]
    fn review_prompt_has_marker_and_integrity_mandate() {
        let p = review_prompt(2, 8);
        assert!(p.contains(RUN_COMPLETE_MARKER));
        assert!(p.contains("report_result"));
        assert!(p.to_lowercase().contains("harness integrity"));
        assert!(p.contains("iteration 2 of max 8"));
    }

    #[test]
    fn impl_prompt_forbids_weakening_and_asks_commit() {
        let p = impl_prompt(1, 8);
        assert!(p.to_lowercase().contains("do not weaken"));
        assert!(p.to_lowercase().contains("commit"));
    }

    #[test]
    fn default_budgets_match_design() {
        let b = RunBudgets::default();
        assert_eq!(b.max_iterations, 8);
        assert_eq!(b.verify_bounce_cap, 2);
        assert_eq!(b.harness_cap, 2);
        assert_eq!(b.wall_clock, Duration::from_secs(1800));
    }

    #[test]
    fn register_run_workspace_adds_workspace_and_indexes_chat() {
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

        let ctx = OverseerContext::builder()
            .config_dir(dir.path().to_path_buf())
            .build();

        let ws_id = register_run_workspace(
            &ctx,
            dir.path(),
            "repo-id",
            "myrepo",
            "narwhal",
            "/repo/narwhal",
            "overdrive/x",
            "run-1",
            "My Task",
        );
        assert!(ws_id.is_some());

        let reg = crate::persistence::load_project_registry(dir.path()).unwrap();
        let p = reg.projects.iter().find(|p| p.id == "repo-id").unwrap();
        assert_eq!(p.workspaces.len(), 1);
        assert_eq!(p.workspaces[0].path, "/repo/narwhal");
        assert_eq!(p.workspaces[0].branch, "overdrive/x");

        let chat_dir = ctx.get_chat_dir("myrepo", "narwhal").unwrap();
        let idx = crate::persistence::index::load_chat_index(&chat_dir).unwrap();
        assert!(idx
            .chats
            .iter()
            .any(|c| c.id == "run-1" && c.label == "My Task"));
    }
}
