//! Agent process spawning and I/O management.
//!
//! This module provides framework-agnostic process management for AI agents.
//! It handles:
//! - Spawning processes in a login shell
//! - Capturing stdout/stderr as line streams
//! - Writing to stdin
//! - Monitoring process exit
//!
//! # Architecture
//!
//! The spawning system uses traits for dependency injection:
//!
//! ```text
//! ┌──────────────────┐     ┌─────────────────────┐
//! │  Agent Managers  │────▶│   ProcessSpawner    │ (trait)
//! └──────────────────┘     └─────────────────────┘
//!                                    ▲
//!                     ┌──────────────┴──────────────┐
//!                     │                             │
//!          ┌────────────────────┐     ┌─────────────────────┐
//!          │DefaultProcessSpawner│     │ MockProcessSpawner  │
//!          │ (real processes)    │     │ (for tests)         │
//!          └────────────────────┘     └─────────────────────┘
//! ```
//!
//! In production, use `DefaultProcessSpawner`. In tests, inject a `MockProcessSpawner`
//! to control what events the "process" emits without spawning real processes.
//!
//! # Agent-Specific Configurations
//!
//! Agent-specific spawn configurations are in their respective modules:
//! - [`crate::agents::claude::ClaudeConfig`]
//! - [`crate::agents::codex::CodexConfig`]
//! - [`crate::agents::copilot::CopilotConfig`]
//! - [`crate::agents::gemini::GeminiConfig`]
//! - [`crate::agents::opencode::OpenCodeConfig`]

use crate::shell::{build_login_shell_command, AgentExit};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Events emitted by an agent process.
#[derive(Debug, Clone)]
pub enum ProcessEvent {
    /// A line was read from stdout
    Stdout(String),
    /// A line was read from stderr
    Stderr(String),
    /// The process exited
    Exit(AgentExit),
}

/// Configuration for spawning an agent process.
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    /// Path to the agent binary
    pub binary_path: String,
    /// Arguments to pass to the binary
    pub args: Vec<String>,
    /// Working directory for the process
    pub working_dir: Option<String>,
    /// Custom shell prefix (e.g., "/bin/zsh -l -c")
    pub shell_prefix: Option<String>,
    /// Initial message to send to stdin after spawning
    pub initial_stdin: Option<String>,
    /// Whether the process uses stdin for communication
    pub uses_stdin: bool,
}

impl SpawnConfig {
    /// Create a new spawn config with required fields.
    pub fn new(binary_path: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            binary_path: binary_path.into(),
            args,
            working_dir: None,
            shell_prefix: None,
            initial_stdin: None,
            uses_stdin: true,
        }
    }

    /// Set the working directory.
    pub fn working_dir(mut self, dir: impl Into<String>) -> Self {
        self.working_dir = Some(dir.into());
        self
    }

    /// Set a custom shell prefix.
    pub fn shell_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.shell_prefix = Some(prefix.into());
        self
    }

    /// Set an initial message to send to stdin.
    pub fn initial_stdin(mut self, message: impl Into<String>) -> Self {
        self.initial_stdin = Some(message.into());
        self
    }

    /// Disable stdin (for processes that don't use it).
    pub fn no_stdin(mut self) -> Self {
        self.uses_stdin = false;
        self
    }
}

// ============================================================================
// PROCESS SPAWNER TRAIT
// ============================================================================
//
// This trait abstracts process creation, allowing tests to inject fake
// processes instead of spawning real OS processes.

/// Trait for spawning agent processes.
///
/// This abstraction allows managers to work with different process implementations:
/// - `DefaultProcessSpawner`: Spawns real OS processes via `AgentProcess::spawn`
/// - `MockProcessSpawner`: Returns fake processes for testing (in test_support.rs)
///
/// # Thread Safety
///
/// Implementations must be `Send + Sync` because spawners may be shared across threads.
///
/// # Example
///
/// ```rust,ignore
/// // Production: use default spawner
/// let spawner = DefaultProcessSpawner::new();
///
/// // Tests: use mock spawner
/// let mock_spawner = MockProcessSpawner::new();
/// mock_spawner.set_next_process(fake_process);
/// ```
pub trait ProcessSpawner: Send + Sync {
    /// Spawn a new agent process.
    ///
    /// # Arguments
    ///
    /// * `config` - Configuration for the process
    ///
    /// # Returns
    ///
    /// A boxed `AgentProcessHandle` for interacting with the spawned process,
    /// along with the event receiver for receiving process events.
    fn spawn(
        &self,
        config: SpawnConfig,
    ) -> Result<(Box<dyn AgentProcessHandle>, Receiver<ProcessEvent>), String>;
}

/// Trait for interacting with a spawned agent process.
///
/// This trait provides a common interface for both real processes (`AgentProcess`)
/// and fake processes used in testing.
///
/// # Thread Safety
///
/// Implementations must be `Send` because process handles may be moved between
/// threads. Note that `Sync` is not required - the handle should be owned by
/// a single thread at a time (typically the manager's event processing thread).
pub trait AgentProcessHandle: Send {
    /// Write data to the process stdin.
    ///
    /// # Arguments
    ///
    /// * `data` - The line to write (newline is added automatically)
    fn write_stdin(&self, data: &str) -> Result<(), String>;

    /// Check if the process is still running.
    fn is_running(&self) -> bool;

    /// Stop the process gracefully.
    ///
    /// On Unix, this sends SIGINT first, then kills after a timeout.
    /// On other platforms, this kills immediately.
    fn stop(&self);

    /// Kill the process immediately.
    fn kill(&self);
}

/// Default process spawner that uses `AgentProcess::spawn`.
///
/// This is the production implementation that spawns real OS processes.
pub struct DefaultProcessSpawner;

impl DefaultProcessSpawner {
    /// Create a new default process spawner.
    pub fn new() -> Self {
        Self
    }
}

impl Default for DefaultProcessSpawner {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessSpawner for DefaultProcessSpawner {
    fn spawn(
        &self,
        config: SpawnConfig,
    ) -> Result<(Box<dyn AgentProcessHandle>, Receiver<ProcessEvent>), String> {
        let mut process = AgentProcess::spawn(config)?;

        // Take the receiver out so we can return it separately
        let receiver = process
            .take_receiver()
            .ok_or_else(|| "Failed to take event receiver".to_string())?;

        Ok((Box::new(process), receiver))
    }
}

/// A running agent process.
///
/// Provides methods to communicate with the process and receive events.
pub struct AgentProcess {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    event_receiver: Receiver<ProcessEvent>,
}

impl AgentProcess {
    /// Spawn a new agent process.
    ///
    /// Returns the process handle and immediately starts background threads
    /// for stdout/stderr reading and exit monitoring.
    pub fn spawn(config: SpawnConfig) -> Result<Self, String> {
        let mut cmd = build_login_shell_command(
            &config.binary_path,
            &config.args,
            config.working_dir.as_deref(),
            config.shell_prefix.as_deref(),
        )?;

        if config.uses_stdin {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

        // Take stdin if available
        let child_stdin = if config.uses_stdin {
            child.stdin.take()
        } else {
            None
        };

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        // Create event channel
        let (tx, rx) = mpsc::channel();

        // Wrap child and stdin in Arc<Mutex> for thread sharing
        let child_arc = Arc::new(Mutex::new(Some(child)));
        let stdin_arc = Arc::new(Mutex::new(child_stdin));

        // Send initial stdin if provided
        if let Some(initial) = config.initial_stdin {
            let mut guard = stdin_arc.lock().unwrap();
            if let Some(ref mut stdin) = *guard {
                writeln!(stdin, "{}", initial)
                    .map_err(|e| format!("Failed to write initial stdin: {e}"))?;
                stdin
                    .flush()
                    .map_err(|e| format!("Failed to flush initial stdin: {e}"))?;
            }
        }

        // Spawn stdout reader thread
        let tx_stdout = tx.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if tx_stdout.send(ProcessEvent::Stdout(line)).is_err() {
                    break;
                }
            }
        });

        // Spawn stderr reader thread
        let tx_stderr = tx.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if tx_stderr.send(ProcessEvent::Stderr(line)).is_err() {
                    break;
                }
            }
        });

        // Spawn exit watcher thread
        let child_arc_exit = Arc::clone(&child_arc);
        let stdin_arc_exit = Arc::clone(&stdin_arc);
        let tx_exit = tx;
        thread::spawn(move || loop {
            let mut guard = child_arc_exit.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let _ = tx_exit.send(ProcessEvent::Exit(AgentExit {
                            code: status.code().unwrap_or_default(),
                            signal: None,
                        }));
                        guard.take();
                        stdin_arc_exit.lock().unwrap().take();
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        guard.take();
                        stdin_arc_exit.lock().unwrap().take();
                        break;
                    }
                }
            } else {
                break;
            }
            drop(guard);
            thread::sleep(Duration::from_millis(100));
        });

        Ok(Self {
            child: child_arc,
            stdin: stdin_arc,
            event_receiver: rx,
        })
    }

    /// Write a line to stdin.
    ///
    /// Returns an error if stdin is not available.
    pub fn write_stdin(&self, data: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().unwrap();
        if let Some(ref mut stdin) = *guard {
            writeln!(stdin, "{}", data).map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
            Ok(())
        } else {
            Err("No active stdin".to_string())
        }
    }

    /// Try to receive the next event without blocking.
    ///
    /// Returns `None` if no event is available.
    pub fn try_recv(&self) -> Option<ProcessEvent> {
        self.event_receiver.try_recv().ok()
    }

    /// Receive the next event, blocking until one is available.
    ///
    /// Returns `None` if the channel is disconnected.
    pub fn recv(&self) -> Option<ProcessEvent> {
        self.event_receiver.recv().ok()
    }

    /// Get the event receiver for integration with other event loops.
    pub fn event_receiver(&self) -> &Receiver<ProcessEvent> {
        &self.event_receiver
    }

    /// Take ownership of the event receiver.
    ///
    /// This allows the receiver to be used independently of the AgentProcess,
    /// enabling blocking receives without holding locks on the process.
    /// After calling this, `try_recv()` and `recv()` will always return `None`.
    pub fn take_receiver(&mut self) -> Option<Receiver<ProcessEvent>> {
        // We need to swap out the receiver. Create a dummy channel.
        let (_, dummy_rx) = std::sync::mpsc::channel();
        Some(std::mem::replace(&mut self.event_receiver, dummy_rx))
    }

    /// Check if the process is still running.
    pub fn is_running(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    /// Stop the process gracefully (SIGINT on Unix, then force kill).
    pub fn stop(&self) {
        // Close stdin first
        self.stdin.lock().unwrap().take();

        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            // Try graceful shutdown on Unix
            #[cfg(unix)]
            {
                let pid = child.id();
                unsafe {
                    libc::kill(pid as i32, libc::SIGINT);
                }
                // Give the process up to 3 seconds to exit gracefully
                for _ in 0..30 {
                    thread::sleep(Duration::from_millis(100));
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            guard.take();
                            return;
                        }
                        Ok(None) => continue,
                        Err(_) => break,
                    }
                }
            }

            // Force kill if still running
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }

    /// Force kill the process immediately.
    pub fn kill(&self) {
        self.stdin.lock().unwrap().take();
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

// Implement AgentProcessHandle for AgentProcess so it can be used
// through the trait interface.
impl AgentProcessHandle for AgentProcess {
    fn write_stdin(&self, data: &str) -> Result<(), String> {
        AgentProcess::write_stdin(self, data)
    }

    fn is_running(&self) -> bool {
        AgentProcess::is_running(self)
    }

    fn stop(&self) {
        AgentProcess::stop(self)
    }

    fn kill(&self) {
        AgentProcess::kill(self)
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_config_builder() {
        let config = SpawnConfig::new("/usr/bin/echo", vec!["hello".to_string()])
            .working_dir("/tmp")
            .shell_prefix("/bin/bash -c")
            .initial_stdin("test")
            .no_stdin();

        assert_eq!(config.binary_path, "/usr/bin/echo");
        assert_eq!(config.args, vec!["hello"]);
        assert_eq!(config.working_dir, Some("/tmp".to_string()));
        assert_eq!(config.shell_prefix, Some("/bin/bash -c".to_string()));
        assert_eq!(config.initial_stdin, Some("test".to_string()));
        assert!(!config.uses_stdin);
    }

    #[test]
    fn process_event_debug() {
        let event = ProcessEvent::Stdout("test".to_string());
        let debug = format!("{:?}", event);
        assert!(debug.contains("Stdout"));
    }

    #[test]
    #[cfg(unix)]
    fn spawn_echo_process() {
        let config = SpawnConfig::new("echo", vec!["hello".to_string()]).no_stdin();

        let process = AgentProcess::spawn(config).unwrap();

        // Should receive stdout line
        let event = process.recv();
        assert!(matches!(event, Some(ProcessEvent::Stdout(s)) if s == "hello"));

        // Should receive exit
        let event = process.recv();
        assert!(matches!(event, Some(ProcessEvent::Exit(e)) if e.code == 0));
    }
}
