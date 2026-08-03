//! Hermes agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Hermes agent.
///
/// Hermes has no `--model` spawn flag — model selection happens at runtime
/// via the ACP `session/set_model` request.
#[derive(Debug, Clone, Default)]
pub struct HermesConfig {
    pub binary_path: String,
    pub shell_prefix: Option<String>,
}

impl HermesConfig {
    /// Build a SpawnConfig for the Hermes CLI ACP server (`hermes acp`).
    pub fn build(self) -> SpawnConfig {
        let args: Vec<String> = vec!["acp".to_string()];

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
    fn hermes_config_builds_acp_args() {
        let config = HermesConfig {
            binary_path: "/usr/local/bin/hermes".to_string(),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/local/bin/hermes");
        assert_eq!(spawn.args, vec!["acp".to_string()]);
    }

    #[test]
    fn hermes_config_passes_shell_prefix() {
        let config = HermesConfig {
            binary_path: "hermes".to_string(),
            shell_prefix: Some("zsh -lc".to_string()),
        };

        let spawn = config.build();
        assert_eq!(spawn.shell_prefix, Some("zsh -lc".to_string()));
    }
}
