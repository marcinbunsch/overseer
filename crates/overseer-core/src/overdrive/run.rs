//! Overdrive run records: the state a run moves through, its persisted form,
//! and the pure decision helpers the state machine uses.
//!
//! The orchestration that *drives* a run lives in [`super::engine`]; this module
//! holds the data model, `overdrive-runs.json` persistence, and the small pure
//! functions (harness registration, red-check / final-verify decisions) that are
//! unit-tested without an agent.

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::harness::CheckResult;
use crate::overseer_actions::OverseerAction;

/// The completion marker the review iteration emits when the task is done.
pub const RUN_COMPLETE_MARKER: &str = "OVERDRIVE_RUN_COMPLETE";

/// Lifecycle status of an Overdrive run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    /// Creating the workspace + chat.
    Provisioning,
    /// Iteration 0: agent builds verification and emits `set_verification`.
    Harness,
    /// Engine runs the registered commands, expecting failure.
    RedCheck,
    /// The impl→review loop.
    Working,
    /// Engine reruns registered commands + repo check, expecting success.
    FinalVerify,
    /// Green; waiting for human review.
    NeedsReview,
    /// Agent asked a question; paused.
    NeedsInput,
    /// Human approved (merge flow).
    Approved,
    /// Human rejected (workspace archived).
    Rejected,
    /// Budget exceeded, thrash limit, or unrecoverable error.
    Failed,
    /// Engine restarted mid-run.
    Interrupted,
}

/// Observed verification facts for a run (never the agent's claims).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationEvidence {
    /// Registered harness commands.
    pub commands: Vec<String>,
    /// Registered harness files (for drift detection).
    #[serde(default)]
    pub files: Vec<String>,
    /// Engine-run red check (expected to fail).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub red_check: Option<CheckResult>,
    /// Engine-run final check (expected to pass).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_check: Option<CheckResult>,
    /// Change summary of harness files between red and final checks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_drift: Option<String>,
}

/// The agent's `report_result` summary, stored on the run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub summary: String,
    #[serde(default)]
    pub assumptions: Vec<String>,
}

/// A single Overdrive run record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdriveRun {
    pub id: String,
    pub task_id: String,
    pub repo_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    pub status: RunStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification: Option<VerificationEvidence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<RunResult>,
    #[serde(default)]
    pub verify_bounces: u32,
    #[serde(default)]
    pub iterations_used: u32,
    pub started_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl OverdriveRun {
    /// A fresh run in `Provisioning` for the given task.
    pub fn new(id: String, task_id: String, repo_id: String) -> Self {
        Self {
            id,
            task_id,
            repo_id,
            workspace_path: None,
            branch: None,
            chat_id: None,
            status: RunStatus::Provisioning,
            verification: None,
            result: None,
            verify_bounces: 0,
            iterations_used: 0,
            started_at: Utc::now(),
            ended_at: None,
            error: None,
        }
    }
}

/// Persisted `overdrive-runs.json` (also the inbox history). A wrapper struct so
/// the file can gain metadata later without a format migration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLog {
    #[serde(default)]
    pub runs: Vec<OverdriveRun>,
}

/// Error type for run persistence.
#[derive(Debug)]
pub enum RunError {
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Io(e) => write!(f, "IO error: {e}"),
            RunError::Json(e) => write!(f, "JSON error: {e}"),
        }
    }
}

impl std::error::Error for RunError {}

impl From<std::io::Error> for RunError {
    fn from(e: std::io::Error) -> Self {
        RunError::Io(e)
    }
}

impl From<serde_json::Error> for RunError {
    fn from(e: serde_json::Error) -> Self {
        RunError::Json(e)
    }
}

/// Load the run log, empty if the file is missing.
pub fn load_runs(config_dir: &Path) -> Result<RunLog, RunError> {
    let path = config_dir.join("overdrive-runs.json");
    if !path.exists() {
        return Ok(RunLog::default());
    }
    let contents = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&contents)?)
}

/// Save the run log atomically (temp file + rename).
pub fn save_runs(config_dir: &Path, log: &RunLog) -> Result<(), RunError> {
    fs::create_dir_all(config_dir)?;
    let path = config_dir.join("overdrive-runs.json");
    let temp = config_dir.join("overdrive-runs.json.tmp");
    let json = serde_json::to_string_pretty(log)?;
    fs::write(&temp, &json)?;
    fs::rename(&temp, &path)?;
    Ok(())
}

/// Insert or replace a run by id, then persist.
pub fn upsert_run(config_dir: &Path, run: OverdriveRun) -> Result<(), RunError> {
    let mut log = load_runs(config_dir)?;
    match log.runs.iter_mut().find(|r| r.id == run.id) {
        Some(existing) => *existing = run,
        None => log.runs.push(run),
    }
    save_runs(config_dir, &log)
}

/// Get a run by id.
pub fn get_run(config_dir: &Path, id: &str) -> Result<Option<OverdriveRun>, RunError> {
    Ok(load_runs(config_dir)?.runs.into_iter().find(|r| r.id == id))
}

/// List all runs (newest first).
pub fn list_runs(config_dir: &Path) -> Result<Vec<OverdriveRun>, RunError> {
    let mut runs = load_runs(config_dir)?.runs;
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(runs)
}

// ============================================================================
// PURE DECISION HELPERS
// ============================================================================

/// Extract the harness registration (commands + files) from a turn's actions.
/// Uses the last `set_verification` if the agent emitted more than one.
pub fn harness_from_actions(actions: &[OverseerAction]) -> Option<(Vec<String>, Vec<String>)> {
    actions.iter().rev().find_map(|a| match a {
        OverseerAction::SetVerification { params } => Some((
            params.commands.clone(),
            params.files.clone().unwrap_or_default(),
        )),
        _ => None,
    })
}

/// Extract the run result from a turn's actions (last `report_result`).
pub fn result_from_actions(actions: &[OverseerAction]) -> Option<RunResult> {
    actions.iter().rev().find_map(|a| match a {
        OverseerAction::ReportResult { params } => Some(RunResult {
            summary: params.summary.clone(),
            assumptions: params.assumptions.clone().unwrap_or_default(),
        }),
        _ => None,
    })
}

/// What to do after the engine runs the red check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedCheckDecision {
    /// Harness failed as expected (or green-start refactor) — start working.
    Proceed,
    /// Harness passed before any work — send it back to the harness phase.
    BounceHarness,
    /// Harness stayed green past the bounce cap — fail the run.
    Fail,
}

/// Decide the next phase after the red check.
///
/// For `expect_green_harness` refactors the criteria is "suite stays green", so
/// a passing check is fine → proceed. Otherwise a passing check proves nothing
/// (the harness is green before the work exists) → bounce, then fail.
pub fn decide_after_red_check(
    check: &CheckResult,
    expect_green: bool,
    harness_bounces: u32,
    bounce_cap: u32,
) -> RedCheckDecision {
    if expect_green {
        return RedCheckDecision::Proceed;
    }
    if check.passed {
        if harness_bounces < bounce_cap {
            RedCheckDecision::BounceHarness
        } else {
            RedCheckDecision::Fail
        }
    } else {
        RedCheckDecision::Proceed
    }
}

/// What to do after the engine runs the final verify.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinalDecision {
    /// All green — move to needs-review.
    Done,
    /// Something red — send it back to the working loop.
    BounceWorking,
    /// Bounced past the cap — fail the run.
    Fail,
}

/// Decide the next phase after the final verify.
pub fn decide_after_final_verify(
    check: &CheckResult,
    verify_bounces: u32,
    bounce_cap: u32,
) -> FinalDecision {
    if check.passed {
        FinalDecision::Done
    } else if verify_bounces < bounce_cap {
        FinalDecision::BounceWorking
    } else {
        FinalDecision::Fail
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overdrive::harness::{CheckResult, CommandOutcome};
    use crate::overseer_actions::{ReportResultParams, SetVerificationParams};
    use tempfile::tempdir;

    fn check(passed: bool) -> CheckResult {
        CheckResult {
            commands: vec![CommandOutcome {
                command: "x".into(),
                exit_code: if passed { 0 } else { 1 },
                success: passed,
                timed_out: false,
                stdout_tail: String::new(),
                stderr_tail: String::new(),
                duration_ms: 1,
            }],
            passed,
        }
    }

    fn sample_run(id: &str) -> OverdriveRun {
        OverdriveRun::new(id.to_string(), "task-1".into(), "repo-1".into())
    }

    // --- persistence ---

    #[test]
    fn load_missing_runs_is_empty() {
        let dir = tempdir().unwrap();
        assert!(load_runs(dir.path()).unwrap().runs.is_empty());
    }

    #[test]
    fn upsert_and_get_run() {
        let dir = tempdir().unwrap();
        upsert_run(dir.path(), sample_run("r1")).unwrap();
        let got = get_run(dir.path(), "r1").unwrap();
        assert!(got.is_some());
        assert_eq!(got.unwrap().task_id, "task-1");
    }

    #[test]
    fn upsert_replaces_existing_run() {
        let dir = tempdir().unwrap();
        upsert_run(dir.path(), sample_run("r1")).unwrap();
        let mut updated = sample_run("r1");
        updated.status = RunStatus::NeedsReview;
        upsert_run(dir.path(), updated).unwrap();

        let log = load_runs(dir.path()).unwrap();
        assert_eq!(log.runs.len(), 1);
        assert_eq!(log.runs[0].status, RunStatus::NeedsReview);
    }

    #[test]
    fn list_runs_newest_first() {
        let dir = tempdir().unwrap();
        let mut older = sample_run("old");
        older.started_at = Utc::now() - chrono::Duration::hours(1);
        let newer = sample_run("new");
        upsert_run(dir.path(), older).unwrap();
        upsert_run(dir.path(), newer).unwrap();

        let runs = list_runs(dir.path()).unwrap();
        assert_eq!(runs[0].id, "new");
        assert_eq!(runs[1].id, "old");
    }

    // --- harness/result extraction ---

    #[test]
    fn harness_from_actions_uses_last_set_verification() {
        let actions = vec![
            OverseerAction::SetVerification {
                params: SetVerificationParams {
                    commands: vec!["first".into()],
                    files: None,
                },
            },
            OverseerAction::SetVerification {
                params: SetVerificationParams {
                    commands: vec!["second".into()],
                    files: Some(vec!["t.rs".into()]),
                },
            },
        ];
        let (commands, files) = harness_from_actions(&actions).unwrap();
        assert_eq!(commands, vec!["second".to_string()]);
        assert_eq!(files, vec!["t.rs".to_string()]);
    }

    #[test]
    fn harness_from_actions_none_when_absent() {
        let actions = vec![OverseerAction::ReportResult {
            params: ReportResultParams {
                summary: "done".into(),
                assumptions: None,
            },
        }];
        assert!(harness_from_actions(&actions).is_none());
    }

    #[test]
    fn result_from_actions_extracts_summary() {
        let actions = vec![OverseerAction::ReportResult {
            params: ReportResultParams {
                summary: "shipped".into(),
                assumptions: Some(vec!["a".into()]),
            },
        }];
        let r = result_from_actions(&actions).unwrap();
        assert_eq!(r.summary, "shipped");
        assert_eq!(r.assumptions, vec!["a".to_string()]);
    }

    // --- red-check decisions ---

    #[test]
    fn red_check_red_proceeds() {
        assert_eq!(
            decide_after_red_check(&check(false), false, 0, 1),
            RedCheckDecision::Proceed
        );
    }

    #[test]
    fn red_check_green_bounces_then_fails() {
        assert_eq!(
            decide_after_red_check(&check(true), false, 0, 1),
            RedCheckDecision::BounceHarness
        );
        assert_eq!(
            decide_after_red_check(&check(true), false, 1, 1),
            RedCheckDecision::Fail
        );
    }

    #[test]
    fn red_check_expect_green_always_proceeds() {
        assert_eq!(
            decide_after_red_check(&check(true), true, 0, 1),
            RedCheckDecision::Proceed
        );
    }

    // --- final-verify decisions ---

    #[test]
    fn final_verify_green_is_done() {
        assert_eq!(
            decide_after_final_verify(&check(true), 0, 2),
            FinalDecision::Done
        );
    }

    #[test]
    fn final_verify_red_bounces_then_fails() {
        assert_eq!(
            decide_after_final_verify(&check(false), 0, 2),
            FinalDecision::BounceWorking
        );
        assert_eq!(
            decide_after_final_verify(&check(false), 2, 2),
            FinalDecision::Fail
        );
    }
}
