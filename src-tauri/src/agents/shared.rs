//! Shared utilities for agent process management.

use serde::Serialize;
use std::process::Command;

/// Exit status emitted when an agent process terminates.
#[derive(Clone, Serialize)]
pub struct AgentExit {
    pub code: i32,
    pub signal: Option<i32>,
}

/// Prepend the binary's parent directory to PATH so node/etc. are found.
pub fn prepare_path_env(cmd: &mut Command, binary_path: &str) {
    if binary_path.contains('/') {
        if let Some(dir) = std::path::Path::new(binary_path).parent() {
            if let Some(dir_str) = dir.to_str() {
                let existing = std::env::var("PATH").unwrap_or_default();
                let combined = if existing.is_empty() {
                    dir_str.to_string()
                } else {
                    format!("{}:{}", dir_str, existing)
                };
                cmd.env("PATH", combined);
            }
        }
    }
}

/// Build a command that runs the given binary with args in a login shell.
///
/// On Unix, this wraps the command in `$SHELL -l -c "..."` to ensure
/// environment variables from profile files are loaded.
/// On Windows, this returns a direct Command (login shell not applicable).
///
/// # Arguments
/// * `binary_path` - Path to the executable
/// * `args` - Arguments to pass to the executable
/// * `working_dir` - Optional working directory
/// * `shell_override` - Optional shell path override (from config)
///
/// # Returns
/// A configured Command ready for further customization (stdin/stdout/stderr)
#[cfg(unix)]
pub fn build_login_shell_command(
    binary_path: &str,
    args: &[String],
    working_dir: Option<&str>,
    shell_override: Option<&str>,
) -> Result<Command, String> {
    // Determine shell to use
    let shell = determine_posix_shell(shell_override);

    // Build the full command string with proper quoting
    let mut command_parts = Vec::with_capacity(args.len() + 1);
    command_parts.push(
        shlex::try_quote(binary_path)
            .map_err(|_| format!("Invalid path: {}", binary_path))?
            .into_owned(),
    );
    for arg in args {
        command_parts.push(
            shlex::try_quote(arg)
                .map_err(|_| format!("Invalid argument: {}", arg))?
                .into_owned(),
        );
    }
    let full_command = command_parts.join(" ");

    let mut cmd = Command::new(&shell);
    cmd.arg("-l") // Login shell - sources profile files
        .arg("-c") // Execute command string
        .arg(&full_command);

    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }

    // Also prepend binary directory to PATH as fallback
    prepare_path_env(&mut cmd, binary_path);

    Ok(cmd)
}

/// Determine which POSIX-compatible shell to use.
///
/// Logic:
/// 1. Use shell_override if provided and non-empty
/// 2. Otherwise use $SHELL env var
/// 3. If shell is non-POSIX (fish, nu, etc.), fall back to /bin/bash or /bin/sh
#[cfg(unix)]
fn determine_posix_shell(shell_override: Option<&str>) -> String {
    let shell = shell_override
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()));

    // Check if shell is POSIX-compatible
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // Non-POSIX shells that don't support `-l -c` properly
    let non_posix = ["fish", "nu", "nushell", "elvish", "xonsh", "ion"];

    if non_posix.iter().any(|&s| shell_name == s) {
        // Try bash first, fall back to sh
        if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash".to_string()
        } else {
            "/bin/sh".to_string()
        }
    } else {
        shell
    }
}

/// Windows version: runs command directly (no login shell concept).
#[cfg(windows)]
pub fn build_login_shell_command(
    binary_path: &str,
    args: &[String],
    working_dir: Option<&str>,
    _shell_override: Option<&str>,
) -> Result<Command, String> {
    let mut cmd = Command::new(binary_path);
    cmd.args(args);

    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }

    prepare_path_env(&mut cmd, binary_path);

    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn test_determine_posix_shell_uses_override() {
        let result = determine_posix_shell(Some("/usr/local/bin/zsh"));
        assert_eq!(result, "/usr/local/bin/zsh");
    }

    #[test]
    #[cfg(unix)]
    fn test_determine_posix_shell_empty_override_uses_env() {
        // Empty override should be ignored
        let result = determine_posix_shell(Some(""));
        // Should fall back to $SHELL or /bin/sh
        assert!(!result.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn test_determine_posix_shell_falls_back_for_fish() {
        let result = determine_posix_shell(Some("/usr/bin/fish"));
        // Should fall back to bash or sh, not fish
        assert!(result == "/bin/bash" || result == "/bin/sh");
    }

    #[test]
    #[cfg(unix)]
    fn test_build_login_shell_command_quotes_paths_with_spaces() {
        let cmd = build_login_shell_command(
            "/path/with spaces/binary",
            &["--arg".to_string(), "value with spaces".to_string()],
            None,
            None,
        )
        .unwrap();

        let program = cmd.get_program();
        // Should be using a shell, not the binary directly
        let prog_str = program.to_str().unwrap();
        assert!(
            prog_str.ends_with("sh") || prog_str.ends_with("zsh") || prog_str.ends_with("bash")
        );
    }

    #[test]
    #[cfg(unix)]
    fn test_build_login_shell_command_handles_special_chars() {
        let result = build_login_shell_command(
            "/path/to/binary",
            &["--key=$VALUE".to_string()],
            None,
            None,
        );
        assert!(result.is_ok());
    }
}
