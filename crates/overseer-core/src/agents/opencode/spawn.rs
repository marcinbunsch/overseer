//! OpenCode agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning an OpenCode server.
#[derive(Debug, Clone, Default)]
pub struct OpenCodeConfig {
    pub binary_path: String,
    pub port: u16,
    pub shell_prefix: Option<String>,
}

impl OpenCodeConfig {
    /// Build a SpawnConfig for OpenCode serve.
    pub fn build(self) -> SpawnConfig {
        let args = vec![
            "serve".to_string(),
            "--port".to_string(),
            self.port.to_string(),
            "--cors".to_string(),
            "http://localhost:1420".to_string(),
        ];

        let mut config = SpawnConfig::new(&self.binary_path, args).no_stdin();

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
    fn opencode_config_builds_correct_args() {
        let config = OpenCodeConfig {
            binary_path: "/usr/bin/opencode".to_string(),
            port: 14096,
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/bin/opencode");
        assert!(spawn.args.contains(&"serve".to_string()));
        assert!(spawn.args.contains(&"--port".to_string()));
        assert!(spawn.args.contains(&"14096".to_string()));
        assert!(spawn.args.contains(&"--cors".to_string()));
        assert!(!spawn.uses_stdin);
    }
}
