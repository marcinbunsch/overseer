//! Codex agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Codex agent.
#[derive(Debug, Clone, Default)]
pub struct CodexConfig {
    pub binary_path: String,
    pub model: Option<String>,
    pub shell_prefix: Option<String>,
}

impl CodexConfig {
    /// Build a SpawnConfig for Codex app-server.
    pub fn build(self) -> SpawnConfig {
        let mut args: Vec<String> = vec!["app-server".to_string()];

        if let Some(ref model) = self.model {
            if !model.is_empty() {
                args.push("-c".to_string());
                args.push(format!("model=\"{}\"", model));
            }
        }

        let mut config = SpawnConfig::new(&self.binary_path, args);

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
    fn codex_config_builds_correct_args() {
        let config = CodexConfig {
            binary_path: "/usr/bin/codex".to_string(),
            model: Some("gpt-4".to_string()),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/bin/codex");
        assert!(spawn.args.contains(&"app-server".to_string()));
        assert!(spawn.args.contains(&"-c".to_string()));
        assert!(spawn.args.iter().any(|a| a.contains("gpt-4")));
    }
}
