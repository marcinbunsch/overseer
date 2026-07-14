//! Per-run Overdrive logs.
//!
//! Each run gets its own file so a broken run is easy to investigate:
//! `{config_dir}/logs/overdrive/{repo}/{ts}-{short-run-id}.log`. The `{ts}`
//! prefix is a sortable UTC stamp so the newest run is easy to find. This logs
//! the *engine's* view (phase transitions, harness commands + exit codes,
//! decisions, off-ramps) — complementary to the agent chat JSONL.

use std::path::Path;

use chrono::{DateTime, Utc};

use crate::logging::{log_line, open_log_file, LogHandle};

/// A handle for appending lines to one run's log file.
pub struct RunLogger {
    handle: LogHandle,
}

impl RunLogger {
    /// Open (or create) the log file for a run under the repo's log directory.
    ///
    /// Falls back to a no-op logger if `config_dir` is `None` or the repo name
    /// is not a safe path component — logging must never break a run.
    pub fn open(
        config_dir: Option<&Path>,
        repo: &str,
        run_id: &str,
        started_at: DateTime<Utc>,
    ) -> Self {
        let dir = config_dir.and_then(|base| {
            if !is_safe_component(repo) {
                return None;
            }
            base.join("logs")
                .join("overdrive")
                .join(repo)
                .to_str()
                .map(|s| s.to_string())
        });

        let log_id = format!(
            "{}-{}",
            started_at.format("%Y%m%dT%H%M%SZ"),
            short_id(run_id)
        );
        let handle = open_log_file(dir.as_deref(), &log_id);
        Self { handle }
    }

    /// Append a timestamped line to the run log.
    pub fn line(&self, msg: impl AsRef<str>) {
        log_line(&self.handle, "RUN", msg.as_ref());
    }
}

/// First 8 chars of the run id (dashes stripped) — keeps filenames short.
fn short_id(run_id: &str) -> String {
    let compact: String = run_id.chars().filter(|c| *c != '-').collect();
    compact.chars().take(8).collect()
}

/// A single normal path component (no traversal, no separators).
fn is_safe_component(s: &str) -> bool {
    use std::path::Component;
    if s.is_empty() {
        return false;
    }
    let mut comps = Path::new(s).components();
    matches!(
        (comps.next(), comps.next()),
        (Some(Component::Normal(_)), None)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn ts() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-14T15:30:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn writes_lines_to_repo_scoped_file() {
        let dir = tempdir().unwrap();
        let logger = RunLogger::open(Some(dir.path()), "my-repo", "abcd1234-5678-90ef", ts());
        logger.line("provisioning");
        logger.line("status → harness");

        let expected = dir
            .path()
            .join("logs/overdrive/my-repo/20260714T153000Z-abcd1234.log");
        assert!(expected.exists(), "log file should exist at {expected:?}");

        let contents = std::fs::read_to_string(&expected).unwrap();
        assert!(contents.contains("RUN: provisioning"));
        assert!(contents.contains("RUN: status → harness"));
    }

    #[test]
    fn filename_is_timestamp_prefixed_for_sorting() {
        let dir = tempdir().unwrap();
        RunLogger::open(Some(dir.path()), "r", "id", ts()).line("x");
        let repo_dir = dir.path().join("logs/overdrive/r");
        let name = std::fs::read_dir(&repo_dir)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .file_name()
            .to_string_lossy()
            .to_string();
        assert!(name.starts_with("20260714T153000Z-"));
        assert!(name.ends_with(".log"));
    }

    #[test]
    fn none_config_dir_is_noop() {
        // Must not panic and must produce no file.
        let logger = RunLogger::open(None, "repo", "id", ts());
        logger.line("ignored");
    }

    #[test]
    fn unsafe_repo_name_is_noop() {
        let dir = tempdir().unwrap();
        let logger = RunLogger::open(Some(dir.path()), "../evil", "id", ts());
        logger.line("ignored");
        assert!(!dir.path().join("logs").exists());
    }
}
