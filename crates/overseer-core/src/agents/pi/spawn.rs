//! Pi agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Pi agent in RPC mode.
#[derive(Debug, Clone, Default)]
pub struct PiConfig {
    pub binary_path: String,
    pub working_dir: String,
    pub shell_prefix: Option<String>,
}

impl PiConfig {
    /// Build a SpawnConfig for Pi RPC mode.
    ///
    /// Pi's RPC mode is a persistent process that accepts commands on stdin
    /// and emits events on stdout as JSONL.
    pub fn build(self) -> SpawnConfig {
        let args: Vec<String> = vec!["--mode".to_string(), "rpc".to_string()];

        let mut config = SpawnConfig::new(&self.binary_path, args)
            .working_dir(&self.working_dir);
        // Pi RPC mode uses stdin for commands (uses_stdin = true by default)

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
    fn pi_config_builds_rpc_mode_args() {
        let config = PiConfig {
            binary_path: "/usr/local/bin/pi".to_string(),
            working_dir: "/tmp/project".to_string(),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/local/bin/pi");
        assert!(spawn.args.contains(&"--mode".to_string()));
        assert!(spawn.args.contains(&"rpc".to_string()));
        assert!(spawn.uses_stdin); // Pi RPC mode uses stdin
    }
}
