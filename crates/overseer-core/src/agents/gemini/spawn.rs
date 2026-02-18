//! Gemini agent spawn configuration.

use crate::spawn::SpawnConfig;

/// Configuration options for spawning a Gemini agent.
#[derive(Debug, Clone, Default)]
pub struct GeminiConfig {
    pub binary_path: String,
    pub working_dir: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub approval_mode: Option<String>,
    pub shell_prefix: Option<String>,
}

impl GeminiConfig {
    /// Build a SpawnConfig for Gemini CLI.
    pub fn build(self) -> SpawnConfig {
        let mut args: Vec<String> = vec![
            "-p".to_string(),
            self.prompt,
            "--output-format".to_string(),
            "stream-json".to_string(),
        ];

        // Add approval mode (defaults to yolo if not specified)
        let mode = self.approval_mode.unwrap_or_else(|| "yolo".to_string());
        args.push("--approval-mode".to_string());
        args.push(mode);

        if let Some(ref model) = self.model {
            if !model.is_empty() {
                args.push("-m".to_string());
                args.push(model.clone());
            }
        }

        if let Some(ref sid) = self.session_id {
            if !sid.is_empty() {
                args.push("--resume".to_string());
                args.push(sid.clone());
            }
        }

        let mut config = SpawnConfig::new(&self.binary_path, args)
            .working_dir(&self.working_dir)
            .no_stdin(); // Gemini doesn't use stdin

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
    fn gemini_config_builds_correct_args() {
        let config = GeminiConfig {
            binary_path: "/usr/bin/gemini".to_string(),
            working_dir: "/tmp".to_string(),
            prompt: "Hello".to_string(),
            session_id: Some("sess-456".to_string()),
            model: Some("gemini-pro".to_string()),
            approval_mode: Some("confirm".to_string()),
            shell_prefix: None,
        };

        let spawn = config.build();
        assert_eq!(spawn.binary_path, "/usr/bin/gemini");
        assert!(spawn.args.contains(&"-p".to_string()));
        assert!(spawn.args.contains(&"Hello".to_string()));
        assert!(spawn.args.contains(&"--output-format".to_string()));
        assert!(spawn.args.contains(&"-m".to_string()));
        assert!(spawn.args.contains(&"gemini-pro".to_string()));
        assert!(spawn.args.contains(&"--resume".to_string()));
        assert!(spawn.args.contains(&"sess-456".to_string()));
        assert!(!spawn.uses_stdin); // Gemini doesn't use stdin
    }
}
