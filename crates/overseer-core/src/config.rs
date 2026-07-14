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
}
