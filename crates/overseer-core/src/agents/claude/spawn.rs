//! Claude agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Claude agent.
#[derive(Debug, Clone, Default)]
pub struct ClaudeConfig {
    pub binary_path: String,
    pub working_dir: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub shell_prefix: Option<String>,
}

impl ClaudeConfig {
    /// Build a SpawnConfig for Claude CLI.
    pub fn build(self) -> SpawnConfig {
        let mode = self.permission_mode.unwrap_or_else(|| "default".to_string());
        let mut args = vec![
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
            "--permission-mode".to_string(),
            mode,
        ];

        if let Some(ref model) = self.model {
            if !model.is_empty() {
                args.push("--model".to_string());
                args.push(model.clone());
            }
        }

        if let Some(ref id) = self.session_id {
            args.push("--resume".to_string());
            args.push(id.clone());
        }

        // Build the initial prompt JSON
        let prompt_json = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": self.prompt
            }
        });

        let mut config = SpawnConfig::new(&self.binary_path, args)
            .working_dir(&self.working_dir)
            .initial_stdin(prompt_json.to_string());

        if let Some(ref shell) = self.shell_prefix {
            config = config.shell_prefix(shell);
        }

        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_config_builds_correct_args() {
        let config = ClaudeConfig {
            binary_path: "/usr/bin/claude".to_string(),
            working_dir: "/tmp".to_string(),
            prompt: "Hello".to_string(),
            session_id: Some("sess-123".to_string()),
            model: Some("opus".to_string()),
            permission_mode: Some("plan".to_string()),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/bin/claude");
        assert!(spawn.args.contains(&"--output-format".to_string()));
        assert!(spawn.args.contains(&"stream-json".to_string()));
        assert!(spawn.args.contains(&"--model".to_string()));
        assert!(spawn.args.contains(&"opus".to_string()));
        assert!(spawn.args.contains(&"--resume".to_string()));
        assert!(spawn.args.contains(&"sess-123".to_string()));
        assert!(spawn.args.contains(&"--permission-mode".to_string()));
        assert!(spawn.args.contains(&"plan".to_string()));
        assert!(spawn.initial_stdin.is_some());
        assert!(spawn.uses_stdin);
    }
}
