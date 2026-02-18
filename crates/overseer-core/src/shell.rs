//! Shell command execution utilities.
//!
//! This module provides platform-aware shell command building for running
//! external commands in the user's login shell environment.
//!
//! # Overview
//!
//! When spawning agent processes or running external commands, we need to:
//! - Use the user's login shell to pick up PATH and environment variables
//! - Handle non-POSIX shells (fish, nushell) by falling back to bash/sh
//! - Properly quote arguments with spaces or special characters
//!
//! # Example
//!
//! ```ignore
//! use overseer_core::shell::build_login_shell_command;
//!
//! let cmd = build_login_shell_command(
//!     "/usr/bin/claude",
//!     &["--help".to_string()],
//!     Some("/path/to/workspace"),
//!     None, // Use default shell
//! )?;
//! ```

use std::process::Command;

/// Exit status emitted when an agent process terminates.
#[derive(Debug, Clone, serde::Serialize)]
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
/// On Unix, this wraps the command using a shell prefix followed by a single-quoted command.
/// Default prefix is `$SHELL -l -c` (with fallback for non-POSIX shells).
/// Custom prefix can be any shell invocation like `/bin/zsh -l -c` or `bash -c`.
///
/// The final command format is: `<prefix> '<quoted_command>'`
///
/// On Windows, this returns a direct Command (login shell not applicable).
///
/// # Arguments
/// * `binary_path` - Path to the executable
/// * `args` - Arguments to pass to the executable
/// * `working_dir` - Optional working directory
/// * `shell_prefix` - Optional shell prefix override (e.g., "/bin/zsh -l -c")
///
/// # Returns
/// A configured Command ready for further customization (stdin/stdout/stderr)
#[cfg(unix)]
pub fn build_login_shell_command(
    binary_path: &str,
    args: &[String],
    working_dir: Option<&str>,
    shell_prefix: Option<&str>,
) -> Result<Command, String> {
    // Get the shell prefix (either custom or default)
    let prefix = get_shell_prefix(shell_prefix);

    // Parse the prefix into shell program and its arguments
    let prefix_parts: Vec<&str> = prefix.split_whitespace().collect();
    if prefix_parts.is_empty() {
        return Err("Empty shell prefix".to_string());
    }

    let shell_program = prefix_parts[0];
    let shell_args = &prefix_parts[1..];

    // Build the full command string with proper quoting for the inner command
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

    let mut cmd = Command::new(shell_program);
    cmd.args(shell_args).arg(&full_command);

    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }

    // Also prepend binary directory to PATH as fallback
    prepare_path_env(&mut cmd, binary_path);

    Ok(cmd)
}

/// Get the shell prefix to use for command execution.
///
/// If a custom prefix is provided (e.g., "/bin/zsh -l -c"), use it directly.
/// Otherwise, build the default prefix from $SHELL with `-l -c` flags.
/// For non-POSIX shells (fish, nu, etc.), fall back to /bin/bash or /bin/sh.
#[cfg(unix)]
fn get_shell_prefix(custom_prefix: Option<&str>) -> String {
    // If user provided a custom prefix, use it as-is
    if let Some(prefix) = custom_prefix {
        if !prefix.is_empty() {
            return prefix.to_string();
        }
    }

    // Build default prefix from $SHELL
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    // Check if shell is POSIX-compatible
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // Non-POSIX shells that don't support `-l -c` properly
    let non_posix = ["fish", "nu", "nushell", "elvish", "xonsh", "ion"];

    let effective_shell = if non_posix.iter().any(|&s| shell_name == s) {
        // Try bash first, fall back to sh
        if std::path::Path::new("/bin/bash").exists() {
            "/bin/bash"
        } else {
            "/bin/sh"
        }
    } else {
        &shell
    };

    format!("{} -l -c", effective_shell)
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

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_exit_serializes() {
        let exit = AgentExit {
            code: 1,
            signal: Some(9),
        };
        let json = serde_json::to_string(&exit).unwrap();
        assert!(json.contains("\"code\":1"));
        assert!(json.contains("\"signal\":9"));
    }

    #[test]
    fn agent_exit_serializes_without_signal() {
        let exit = AgentExit {
            code: 0,
            signal: None,
        };
        let json = serde_json::to_string(&exit).unwrap();
        assert!(json.contains("\"code\":0"));
        assert!(json.contains("\"signal\":null"));
    }

    #[test]
    #[cfg(unix)]
    fn test_get_shell_prefix_uses_custom_prefix() {
        let result = get_shell_prefix(Some("/bin/zsh -l -c"));
        assert_eq!(result, "/bin/zsh -l -c");
    }

    #[test]
    #[cfg(unix)]
    fn test_get_shell_prefix_custom_without_flags() {
        // User can provide any prefix format
        let result = get_shell_prefix(Some("/usr/bin/bash -c"));
        assert_eq!(result, "/usr/bin/bash -c");
    }

    #[test]
    #[cfg(unix)]
    fn test_get_shell_prefix_empty_uses_default() {
        // Empty prefix should fall back to default
        let result = get_shell_prefix(Some(""));
        // Should contain -l -c flags
        assert!(result.ends_with(" -l -c"));
    }

    #[test]
    #[cfg(unix)]
    fn test_get_shell_prefix_none_uses_default() {
        let result = get_shell_prefix(None);
        // Should contain -l -c flags
        assert!(result.ends_with(" -l -c"));
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

    #[test]
    #[cfg(unix)]
    fn test_build_login_shell_command_with_custom_prefix() {
        let cmd = build_login_shell_command(
            "/usr/bin/claude",
            &["--help".to_string()],
            None,
            Some("/bin/bash -c"),
        )
        .unwrap();

        let program = cmd.get_program();
        assert_eq!(program.to_str().unwrap(), "/bin/bash");

        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args[0].to_str().unwrap(), "-c");
    }
}
