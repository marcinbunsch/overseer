//! Verification harness runner.
//!
//! Overdrive's core rule: *the agent never gets to declare success; the engine
//! observes it.* Agents under a "finish the task" objective will hallucinate
//! "all tests pass ✓" — but they can't hallucinate an exit code from a process
//! the engine spawned. This module is that observer.
//!
//! It is deliberately **pure and agent-free**: given a list of shell commands
//! and a workspace, [`run_check`] runs them and captures real exit codes +
//! output tails, and [`snapshot_harness`] / [`diff_harness`] capture the
//! registered harness files so later phases can flag gamed verification
//! (deleted assertions, weakened tests). No agent, run state machine, or
//! scheduler here — those consume this in Phase 4.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::shell::{run_shell_command_with_timeout, CommandRun};

/// Result of running one harness command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CommandOutcome {
    /// The command that was run.
    pub command: String,
    /// Process exit code (`-1` if unavailable, e.g. killed by signal or timeout).
    pub exit_code: i32,
    /// True iff the process exited 0 and did not time out.
    pub success: bool,
    /// True iff the command was killed for exceeding its timeout.
    pub timed_out: bool,
    /// Last lines of stdout (trimmed — full output can be huge).
    pub stdout_tail: String,
    /// Last lines of stderr.
    pub stderr_tail: String,
    /// Wall-clock duration of the command in milliseconds.
    pub duration_ms: u64,
}

/// Result of running a full set of harness commands (a "check").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CheckResult {
    /// Per-command outcomes, in the order the commands were given.
    pub commands: Vec<CommandOutcome>,
    /// True iff every command succeeded (exit 0, no timeout).
    pub passed: bool,
}

/// A snapshot of the registered harness files' contents, keyed by path.
///
/// `Some(hash)` = file present with that content hash; `None` = file absent.
/// Compared across the red check and the final check to detect drift.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HarnessSnapshot {
    /// Path (as given) → content hash, or `None` if the file did not exist.
    pub files: BTreeMap<String, Option<u64>>,
}

/// Keep at most this many trailing lines of captured output.
const TAIL_LINES: usize = 50;

/// Run a set of harness commands sequentially in `working_dir`, capturing the
/// real exit code + output tail of each.
///
/// Every command runs (we do *not* stop at the first failure) so the evidence
/// card can show the full picture. Each command is bounded by
/// `per_command_timeout`; a command that blows past it is killed and marked
/// `timed_out`. The check `passed` only if every command succeeded.
pub async fn run_check(
    commands: &[String],
    working_dir: &str,
    shell_prefix: Option<&str>,
    per_command_timeout: Duration,
) -> CheckResult {
    let mut outcomes = Vec::with_capacity(commands.len());

    for command in commands {
        let start = Instant::now();
        let run =
            run_shell_command_with_timeout(command, working_dir, shell_prefix, per_command_timeout)
                .await;
        let duration_ms = start.elapsed().as_millis() as u64;

        let outcome = match run {
            Ok(CommandRun::Finished(result)) => CommandOutcome {
                command: command.clone(),
                exit_code: result.exit_code,
                success: result.success,
                timed_out: false,
                stdout_tail: tail(&result.stdout, TAIL_LINES),
                stderr_tail: tail(&result.stderr, TAIL_LINES),
                duration_ms,
            },
            Ok(CommandRun::TimedOut) => CommandOutcome {
                command: command.clone(),
                exit_code: -1,
                success: false,
                timed_out: true,
                stdout_tail: String::new(),
                stderr_tail: format!("<timed out after {}s>", per_command_timeout.as_secs()),
                duration_ms,
            },
            // Spawn failure (bad shell prefix, etc.) — surface it as a failed
            // command rather than losing it.
            Err(err) => CommandOutcome {
                command: command.clone(),
                exit_code: -1,
                success: false,
                timed_out: false,
                stdout_tail: String::new(),
                stderr_tail: err,
                duration_ms,
            },
        };

        outcomes.push(outcome);
    }

    let passed = outcomes.iter().all(|c| c.success && !c.timed_out);
    CheckResult {
        commands: outcomes,
        passed,
    }
}

/// Snapshot the contents of the registered harness files under `working_dir`.
///
/// `paths` are relative to `working_dir`. Missing files record `None` (which is
/// itself meaningful — a harness file appearing or vanishing is drift). The hash
/// is used only for equality within a single run, so a fast std hasher suffices.
///
/// *Which* paths count as harness files is a later-phase concern (derived from
/// the verification registration); this runner is generic over an explicit list.
pub fn snapshot_harness(working_dir: &Path, paths: &[String]) -> HarnessSnapshot {
    let mut files = BTreeMap::new();
    for path in paths {
        let full = working_dir.join(path);
        let hash = std::fs::read(&full).ok().map(|bytes| hash_bytes(&bytes));
        files.insert(path.clone(), hash);
    }
    HarnessSnapshot { files }
}

/// Compare two harness snapshots and summarise what moved.
///
/// Returns `None` if identical, otherwise a short human-readable summary of
/// changed / added / removed files. This only answers "did the registered
/// harness files move?" — the actual unified diff for review is covered by
/// `git::diff` + the review iteration.
pub fn diff_harness(before: &HarnessSnapshot, after: &HarnessSnapshot) -> Option<String> {
    let mut notes = Vec::new();

    for (path, before_hash) in &before.files {
        match after.files.get(path) {
            Some(after_hash) if after_hash == before_hash => {} // unchanged
            Some(after_hash) => match (before_hash, after_hash) {
                (Some(_), None) => notes.push(format!("removed: {path}")),
                (None, Some(_)) => notes.push(format!("added: {path}")),
                _ => notes.push(format!("changed: {path}")),
            },
            None => notes.push(format!("changed: {path}")), // dropped from tracked set
        }
    }

    // Paths present only in `after` (newly tracked) count as additions too.
    for path in after.files.keys() {
        if !before.files.contains_key(path) {
            notes.push(format!("added: {path}"));
        }
    }

    if notes.is_empty() {
        None
    } else {
        notes.sort();
        Some(notes.join("\n"))
    }
}

/// Keep the last `max_lines` lines of `s` (with a leading marker if truncated).
fn tail(s: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if lines.len() <= max_lines {
        return s.to_string();
    }
    let kept = &lines[lines.len() - max_lines..];
    format!(
        "… ({} earlier lines omitted)\n{}",
        lines.len() - max_lines,
        kept.join("\n")
    )
}

/// Hash file bytes with the default std hasher (stable within a process run).
fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

// ============================================================================
// TESTS
// ============================================================================
//
// Pure and agent-free: exercised against a temp dir with trivial shell
// commands (`true`, `false`, `sleep`) — no project or agent CLI needed.

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const TIMEOUT: Duration = Duration::from_secs(5);

    // ------------------------------------------------------------------------
    // run_check
    // ------------------------------------------------------------------------

    #[tokio::test]
    #[cfg(unix)]
    async fn run_check_all_pass() {
        let result = run_check(
            &["true".to_string(), "echo hi".to_string()],
            "/tmp",
            None,
            TIMEOUT,
        )
        .await;
        assert!(result.passed);
        assert_eq!(result.commands.len(), 2);
        assert!(result.commands.iter().all(|c| c.success));
        assert!(result.commands[1].stdout_tail.contains("hi"));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_check_failure_marks_not_passed() {
        let result = run_check(&["exit 2".to_string()], "/tmp", None, TIMEOUT).await;
        assert!(!result.passed);
        assert_eq!(result.commands[0].exit_code, 2);
        assert!(!result.commands[0].success);
        assert!(!result.commands[0].timed_out);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_check_runs_all_commands_even_after_failure() {
        // The second command must still run and be captured.
        let result = run_check(
            &["false".to_string(), "echo second".to_string()],
            "/tmp",
            None,
            TIMEOUT,
        )
        .await;
        assert!(!result.passed);
        assert_eq!(result.commands.len(), 2);
        assert!(!result.commands[0].success);
        assert!(result.commands[1].success);
        assert!(result.commands[1].stdout_tail.contains("second"));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_check_timeout_marks_timed_out() {
        let start = Instant::now();
        let result = run_check(
            &["sleep 5".to_string()],
            "/tmp",
            None,
            Duration::from_millis(100),
        )
        .await;
        assert!(!result.passed);
        assert!(result.commands[0].timed_out);
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_check_empty_commands_passes_vacuously() {
        let result = run_check(&[], "/tmp", None, TIMEOUT).await;
        assert!(result.passed);
        assert!(result.commands.is_empty());
    }

    // ------------------------------------------------------------------------
    // snapshot_harness / diff_harness
    // ------------------------------------------------------------------------

    #[test]
    fn snapshot_identical_has_no_drift() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("test.rs"), b"assert!(true)").unwrap();

        let paths = vec!["test.rs".to_string()];
        let before = snapshot_harness(dir.path(), &paths);
        let after = snapshot_harness(dir.path(), &paths);

        assert_eq!(diff_harness(&before, &after), None);
    }

    #[test]
    fn snapshot_detects_modification() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.rs");
        std::fs::write(&file, b"assert!(real_condition)").unwrap();

        let paths = vec!["test.rs".to_string()];
        let before = snapshot_harness(dir.path(), &paths);

        // Agent weakens the assertion.
        std::fs::write(&file, b"assert!(true)").unwrap();
        let after = snapshot_harness(dir.path(), &paths);

        let drift = diff_harness(&before, &after).expect("expected drift");
        assert!(drift.contains("changed: test.rs"), "got: {drift}");
    }

    #[test]
    fn snapshot_detects_added_file() {
        let dir = tempdir().unwrap();
        let paths = vec!["test.rs".to_string()];

        // Absent at snapshot time...
        let before = snapshot_harness(dir.path(), &paths);
        std::fs::write(dir.path().join("test.rs"), b"new").unwrap();
        let after = snapshot_harness(dir.path(), &paths);

        let drift = diff_harness(&before, &after).expect("expected drift");
        assert!(drift.contains("added: test.rs"), "got: {drift}");
    }

    #[test]
    fn snapshot_detects_removed_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.rs");
        std::fs::write(&file, b"content").unwrap();
        let paths = vec!["test.rs".to_string()];

        let before = snapshot_harness(dir.path(), &paths);
        std::fs::remove_file(&file).unwrap();
        let after = snapshot_harness(dir.path(), &paths);

        let drift = diff_harness(&before, &after).expect("expected drift");
        assert!(drift.contains("removed: test.rs"), "got: {drift}");
    }

    #[test]
    fn snapshot_absent_in_both_is_no_drift() {
        let dir = tempdir().unwrap();
        let paths = vec!["nonexistent.rs".to_string()];

        let before = snapshot_harness(dir.path(), &paths);
        let after = snapshot_harness(dir.path(), &paths);

        assert_eq!(diff_harness(&before, &after), None);
    }

    // ------------------------------------------------------------------------
    // tail
    // ------------------------------------------------------------------------

    #[test]
    fn tail_keeps_short_output_verbatim() {
        assert_eq!(tail("a\nb\nc", 50), "a\nb\nc");
    }

    #[test]
    fn tail_truncates_long_output_to_last_lines() {
        let input: String = (0..100)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let out = tail(&input, 10);
        assert!(out.contains("earlier lines omitted"));
        assert!(out.contains("99"));
        assert!(!out.contains("\n0\n")); // early lines dropped
    }
}
