//! Reading the app's `config.json` from core.
//!
//! The desktop app writes `config.json` (agent binary paths, default models,
//! shell). The headless Overdrive engine needs the same values to spawn agents
//! with no frontend attached, so this provides a framework-agnostic reader.

use std::path::Path;

use serde::Deserialize;

/// Subset of `config.json` the engine needs to spawn an agent headless.
///
/// All fields optional — a missing file yields all-`None`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Path to the `claude` binary (may contain `$HOME` / `~`).
    pub claude_path: Option<String>,
    /// Shell prefix override for agent spawns (e.g. "/bin/zsh -l -c").
    pub agent_shell: Option<String>,
    /// Default Claude model alias.
    pub default_claude_model: Option<String>,
    /// Global Overdrive scheduler settings.
    pub overdrive: OverdriveSettings,
}

/// Global Overdrive scheduler settings (the `overdrive` object in config.json).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverdriveSettings {
    /// Whether the interval scheduler is allowed to pick up work. Off by default.
    pub scheduler_enabled: bool,
    /// Scheduler tick interval in minutes.
    pub interval_minutes: u32,
    /// Pause picking new work when this many runs sit in needs-review.
    pub backpressure_cap: u32,
    /// Fail a run blocked on input after this many hours.
    pub needs_input_timeout_hours: u32,
    /// Only start runs at/after this local time ("HH:MM"). None = no lower bound.
    pub run_window_start: Option<String>,
    /// Only start runs before this local time ("HH:MM"). None = no upper bound.
    pub run_window_end: Option<String>,
}

impl Default for OverdriveSettings {
    fn default() -> Self {
        Self {
            scheduler_enabled: false,
            interval_minutes: 15,
            backpressure_cap: 3,
            needs_input_timeout_hours: 4,
            run_window_start: None,
            run_window_end: None,
        }
    }
}

impl AppConfig {
    /// The claude binary path with `$HOME`/`~` expanded, defaulting to `"claude"`
    /// (resolved via login-shell PATH when spawned).
    pub fn resolved_claude_path(&self) -> String {
        self.claude_path
            .as_deref()
            .map(expand_home)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "claude".to_string())
    }

    /// The agent shell prefix with `$HOME`/`~` expanded, if set.
    pub fn resolved_agent_shell(&self) -> Option<String> {
        self.agent_shell.as_deref().map(expand_home)
    }
}

/// Read `config.json` from the config directory. Returns a default (all-`None`)
/// config if the file is missing or unparseable — the engine falls back to
/// `"claude"` on PATH, which is the desktop app's own fallback.
pub fn read_app_config(config_dir: &Path) -> AppConfig {
    let path = config_dir.join("config.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

/// Expand a leading `~` or any `$HOME` with the `HOME` env var. No-op if `HOME`
/// is unset.
fn expand_home(value: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) => expand_with_home(value, &home),
        Err(_) => value.to_string(),
    }
}

/// Pure expansion against an explicit home dir (keeps tests off the global env).
fn expand_with_home(value: &str, home: &str) -> String {
    let mut out = value.to_string();
    if let Some(rest) = out.strip_prefix('~') {
        out = format!("{home}{rest}");
    }
    out.replace("$HOME", home)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn missing_file_yields_default() {
        let dir = tempdir().unwrap();
        let cfg = read_app_config(dir.path());
        assert!(cfg.claude_path.is_none());
        assert_eq!(cfg.resolved_claude_path(), "claude");
    }

    #[test]
    fn reads_fields_from_config_json() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("config.json"),
            r#"{"claudePath": "/usr/local/bin/claude", "agentShell": "/bin/zsh -l -c", "defaultClaudeModel": "claude-opus-4-8", "someOtherKey": 1}"#,
        )
        .unwrap();

        let cfg = read_app_config(dir.path());
        assert_eq!(cfg.resolved_claude_path(), "/usr/local/bin/claude");
        assert_eq!(
            cfg.resolved_agent_shell().as_deref(),
            Some("/bin/zsh -l -c")
        );
        assert_eq!(cfg.default_claude_model.as_deref(), Some("claude-opus-4-8"));
    }

    #[test]
    fn expands_home_var() {
        // Pure expansion — no mutation of the process-global HOME (that would
        // race other tests that read HOME, e.g. workspace dir selection).
        assert_eq!(
            expand_with_home("$HOME/.local/bin/claude", "/home/tester"),
            "/home/tester/.local/bin/claude"
        );
    }

    #[test]
    fn expands_tilde_prefix() {
        assert_eq!(
            expand_with_home("~/bin/claude", "/home/tester"),
            "/home/tester/bin/claude"
        );
    }

    #[test]
    fn malformed_json_yields_default() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("config.json"), "not json").unwrap();
        let cfg = read_app_config(dir.path());
        assert_eq!(cfg.resolved_claude_path(), "claude");
    }

    #[test]
    fn overdrive_settings_default_off() {
        let dir = tempdir().unwrap();
        let cfg = read_app_config(dir.path());
        assert!(!cfg.overdrive.scheduler_enabled);
        assert_eq!(cfg.overdrive.interval_minutes, 15);
        assert_eq!(cfg.overdrive.backpressure_cap, 3);
        assert_eq!(cfg.overdrive.needs_input_timeout_hours, 4);
    }

    #[test]
    fn overdrive_settings_parsed_from_config() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("config.json"),
            r#"{"overdrive": {"schedulerEnabled": true, "intervalMinutes": 5, "backpressureCap": 1, "runWindowStart": "22:00", "runWindowEnd": "07:00"}}"#,
        )
        .unwrap();
        let cfg = read_app_config(dir.path());
        assert!(cfg.overdrive.scheduler_enabled);
        assert_eq!(cfg.overdrive.interval_minutes, 5);
        assert_eq!(cfg.overdrive.backpressure_cap, 1);
        assert_eq!(cfg.overdrive.run_window_start.as_deref(), Some("22:00"));
        assert_eq!(cfg.overdrive.run_window_end.as_deref(), Some("07:00"));
    }
}
