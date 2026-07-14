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
use tokio::process::Command as AsyncCommand;

/// Exit status emitted when an agent process terminates.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentExit {
    pub code: i32,
    pub signal: Option<i32>,
}

/// Result of running a shell command.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

/// Run a shell command in a login shell and return the result.
///
/// This is useful for running setup scripts (like postCreate) that need
/// the user's environment variables (PATH, etc.).
///
/// # Arguments
/// * `command` - The command to run (will be passed to the shell)
/// * `working_dir` - The directory to run the command in
/// * `shell_prefix` - Optional shell prefix override (e.g., "/bin/zsh -l -c")
pub fn run_shell_command(
    command: &str,
    working_dir: &str,
    shell_prefix: Option<&str>,
) -> Result<ShellCommandResult, String> {
    // Get the shell prefix (either custom or default)
    let prefix = get_shell_prefix(shell_prefix);

    // Parse the prefix into shell program and its arguments
    let prefix_parts: Vec<&str> = prefix.split_whitespace().collect();
    if prefix_parts.is_empty() {
        return Err("Empty shell prefix".to_string());
    }

    let shell_program = prefix_parts[0];
    let shell_args = &prefix_parts[1..];

    let mut cmd = Command::new(shell_program);
    cmd.args(shell_args)
        .arg(command)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ShellCommandResult {
        exit_code,
        stdout,
        stderr,
        success: output.status.success(),
    })
}

/// Async version of `run_shell_command`.
///
/// Run a shell command in a login shell and return the result asynchronously.
///
/// # Arguments
/// * `command` - The command to run (will be passed to the shell)
/// * `working_dir` - The directory to run the command in
/// * `shell_prefix` - Optional shell prefix override (e.g., "/bin/zsh -l -c")
pub async fn run_shell_command_async(
    command: &str,
    working_dir: &str,
    shell_prefix: Option<&str>,
) -> Result<ShellCommandResult, String> {
    // Get the shell prefix (either custom or default)
    let prefix = get_shell_prefix(shell_prefix);

    // Parse the prefix into shell program and its arguments
    let prefix_parts: Vec<&str> = prefix.split_whitespace().collect();
    if prefix_parts.is_empty() {
        return Err("Empty shell prefix".to_string());
    }

    let shell_program = prefix_parts[0];
    let shell_args = &prefix_parts[1..];

    let mut cmd = AsyncCommand::new(shell_program);
    cmd.args(shell_args)
        .arg(command)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ShellCommandResult {
        exit_code,
        stdout,
        stderr,
        success: output.status.success(),
    })
}

/// Outcome of a command run with a wall-clock bound.
///
/// Distinguishes a process that finished (with whatever exit code) from one the
/// engine had to kill because it blew past its timeout — the harness runner
/// needs to tell these apart (a hung `pnpm test` is not the same as a failing
/// one).
#[derive(Debug)]
pub enum CommandRun {
    /// The command ran to completion (success or non-zero exit).
    Finished(ShellCommandResult),
    /// The command exceeded its timeout and was killed.
    TimedOut,
}

/// Run a shell command in a login shell, bounded by a wall-clock `timeout`.
///
/// Same login-shell semantics as [`run_shell_command_async`], but the child is
/// spawned with `kill_on_drop(true)`; if the `timeout` elapses first, the wait
/// future is dropped and the OS kills the process tree. Returns
/// [`CommandRun::TimedOut`] in that case rather than hanging forever.
///
/// # Arguments
/// * `command` - The command to run (passed to the shell as a single arg)
/// * `working_dir` - The directory to run the command in
/// * `shell_prefix` - Optional shell prefix override (e.g., "/bin/zsh -l -c")
/// * `timeout` - Maximum wall-clock time before the command is killed
pub async fn run_shell_command_with_timeout(
    command: &str,
    working_dir: &str,
    shell_prefix: Option<&str>,
    timeout: std::time::Duration,
) -> Result<CommandRun, String> {
    let prefix = get_shell_prefix(shell_prefix);

    let prefix_parts: Vec<&str> = prefix.split_whitespace().collect();
    if prefix_parts.is_empty() {
        return Err("Empty shell prefix".to_string());
    }

    let shell_program = prefix_parts[0];
    let shell_args = &prefix_parts[1..];

    let mut cmd = AsyncCommand::new(shell_program);
    cmd.args(shell_args)
        .arg(command)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Ensure a timed-out command doesn't linger after we stop waiting.
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // On timeout the wait future is dropped, which drops the Child and (via
    // kill_on_drop) sends SIGKILL — so no zombie survives the deadline.
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(CommandRun::Finished(ShellCommandResult {
                exit_code,
                stdout,
                stderr,
                success: output.status.success(),
            }))
        }
        Ok(Err(e)) => Err(format!("Failed to wait for command: {}", e)),
        Err(_elapsed) => Ok(CommandRun::TimedOut),
    }
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
    use std::time::Duration;

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
        let result =
            build_login_shell_command("/path/to/binary", &["--key=$VALUE".to_string()], None, None);
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

    // ------------------------------------------------------------------------
    // run_shell_command_with_timeout
    // ------------------------------------------------------------------------

    #[tokio::test]
    #[cfg(unix)]
    async fn timeout_command_success_finishes() {
        let run = run_shell_command_with_timeout("true", "/tmp", None, Duration::from_secs(5))
            .await
            .unwrap();
        match run {
            CommandRun::Finished(result) => {
                assert!(result.success);
                assert_eq!(result.exit_code, 0);
            }
            CommandRun::TimedOut => panic!("`true` should not time out"),
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn timeout_command_failure_reports_exit_code() {
        let run = run_shell_command_with_timeout("exit 3", "/tmp", None, Duration::from_secs(5))
            .await
            .unwrap();
        match run {
            CommandRun::Finished(result) => {
                assert!(!result.success);
                assert_eq!(result.exit_code, 3);
            }
            CommandRun::TimedOut => panic!("`exit 3` should not time out"),
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn timeout_command_captures_stdout() {
        let run =
            run_shell_command_with_timeout("echo hello", "/tmp", None, Duration::from_secs(5))
                .await
                .unwrap();
        match run {
            CommandRun::Finished(result) => assert!(result.stdout.contains("hello")),
            CommandRun::TimedOut => panic!("`echo` should not time out"),
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn timeout_kills_a_hung_command_promptly() {
        let start = std::time::Instant::now();
        let run =
            run_shell_command_with_timeout("sleep 5", "/tmp", None, Duration::from_millis(100))
                .await
                .unwrap();
        assert!(matches!(run, CommandRun::TimedOut));
        // Must return near the deadline, not after the full sleep.
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "timed-out command should return promptly, took {:?}",
            start.elapsed()
        );
    }
}
