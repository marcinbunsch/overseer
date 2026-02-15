//! Copilot agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Copilot agent.
#[derive(Debug, Clone, Default)]
pub struct CopilotConfig {
    pub binary_path: String,
    pub model: Option<String>,
    pub shell_prefix: Option<String>,
}

impl CopilotConfig {
    /// Build a SpawnConfig for Copilot CLI.
    pub fn build(self) -> SpawnConfig {
        let mut args: Vec<String> = vec!["--acp".to_string(), "--stdio".to_string()];

        if let Some(ref model) = self.model {
            if !model.is_empty() {
                args.push("--model".to_string());
                args.push(model.clone());
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
    fn copilot_config_builds_correct_args() {
        let config = CopilotConfig {
            binary_path: "/usr/bin/copilot".to_string(),
            model: Some("gpt-4o".to_string()),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/bin/copilot");
        assert!(spawn.args.contains(&"--acp".to_string()));
        assert!(spawn.args.contains(&"--stdio".to_string()));
        assert!(spawn.args.contains(&"--model".to_string()));
        assert!(spawn.args.contains(&"gpt-4o".to_string()));
    }
}
