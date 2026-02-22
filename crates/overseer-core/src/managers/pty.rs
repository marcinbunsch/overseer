//! PTY (pseudo-terminal) manager.
//!
//! Manages pseudo-terminal processes for terminal emulation.
//!
//! # Architecture
//!
//! The PTY manager uses a backend trait (`PtyBackend`) to abstract the underlying
//! PTY implementation. This allows tests to use a mock backend instead of spawning
//! real terminals.
//!
//! ```text
//! ┌─────────────────┐     ┌──────────────────┐
//! │   PtyManager    │────▶│   PtyBackend     │ (trait)
//! └─────────────────┘     └──────────────────┘
//!                                  ▲
//!                    ┌─────────────┴─────────────┐
//!                    │                           │
//!          ┌─────────────────┐        ┌─────────────────┐
//!          │ NativePtyBackend│        │  MockPtyBackend │
//!          │ (real PTY)      │        │  (for tests)    │
//!          └─────────────────┘        └─────────────────┘
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! // Production code uses the default (native) backend
//! let manager = PtyManager::new();
//!
//! // Tests can inject a mock backend
//! let mock_backend = Arc::new(MockPtyBackend::new());
//! let manager = PtyManager::with_backend(mock_backend);
//! ```

use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

use crate::event_bus::EventBus;

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/// Exit event for a PTY.
///
/// Emitted when a PTY process exits. The code is optional because
/// we don't always know the exit code (e.g., when the process is killed).
#[derive(Clone, Serialize, Debug)]
pub struct PtyExit {
    pub code: Option<u32>,
}

/// Configuration for spawning a PTY.
///
/// Contains all the information needed to create a new pseudo-terminal
/// with a shell process.
#[derive(Debug, Clone)]
pub struct PtySpawnConfig {
    /// Unique identifier for this PTY instance.
    pub id: String,

    /// Working directory for the shell.
    pub cwd: String,

    /// Path to the shell executable (e.g., "/bin/zsh").
    pub shell: String,

    /// Initial terminal width in columns.
    pub cols: u16,

    /// Initial terminal height in rows.
    pub rows: u16,

    /// Optional workspace root path, set as WORKSPACE_ROOT env var.
    /// Used by post-create scripts to know where the workspace is.
    pub workspace_root: Option<String>,
}

// ============================================================================
// PTY BACKEND TRAIT
// ============================================================================
//
// This trait abstracts the PTY system, allowing us to:
// 1. Use the real `portable_pty` in production
// 2. Use a mock implementation in tests (no real PTY spawning)

/// Abstraction over PTY operations.
///
/// This trait allows the PtyManager to work with different PTY implementations:
/// - `NativePtyBackend`: Uses `portable_pty` for real terminal operations
/// - `MockPtyBackend`: Fake implementation for testing (in test_support.rs)
///
/// # Thread Safety
///
/// Implementations must be `Send + Sync` because the PtyManager is shared
/// across threads. The backend may be called from multiple threads concurrently.
///
/// # Error Handling
///
/// All operations return `Result<_, String>` for simplicity. In production,
/// errors come from the underlying PTY library. In tests, the mock can
/// be configured to return specific errors.
pub trait PtyBackend: Send + Sync {
    /// Open a new PTY pair.
    ///
    /// Returns a `PtyPair` containing the master and slave handles.
    /// The slave is used to spawn the shell process.
    ///
    /// # Arguments
    ///
    /// * `cols` - Initial terminal width in columns
    /// * `rows` - Initial terminal height in rows
    fn open_pty(&self, cols: u16, rows: u16) -> Result<Box<dyn PtyPair>, String>;
}

/// A PTY master/slave pair.
///
/// This trait represents an opened PTY before a process is spawned.
/// Use `spawn_shell` to start a shell process in the PTY.
pub trait PtyPair: Send {
    /// Spawn a shell in this PTY.
    ///
    /// # Arguments
    ///
    /// * `shell` - Path to the shell executable
    /// * `cwd` - Working directory for the shell
    /// * `env` - Environment variables to set (key, value pairs)
    ///
    /// # Returns
    ///
    /// A `PtyHandle` for interacting with the spawned process.
    fn spawn_shell(
        self: Box<Self>,
        shell: &str,
        cwd: &str,
        env: Vec<(String, String)>,
    ) -> Result<Box<dyn PtyHandle>, String>;
}

/// Handle to a running PTY process.
///
/// Provides methods to read from, write to, resize, and kill the PTY.
/// The handle owns the PTY resources - dropping it will close the PTY.
pub trait PtyHandle: Send {
    /// Get a reader for the PTY output.
    ///
    /// Returns a boxed reader that can be used in a separate thread
    /// to read output from the PTY.
    fn take_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;

    /// Get a writer for sending input to the PTY.
    ///
    /// Returns an Arc-wrapped writer that can be shared across threads.
    fn take_writer(&mut self) -> Result<Arc<Mutex<Box<dyn Write + Send>>>, String>;

    /// Resize the PTY.
    ///
    /// # Arguments
    ///
    /// * `cols` - New terminal width in columns
    /// * `rows` - New terminal height in rows
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;

    /// Kill the PTY process.
    fn kill(&mut self) -> Result<(), String>;
}

// ============================================================================
// NATIVE PTY BACKEND (Production)
// ============================================================================
//
// Uses the `portable_pty` crate for real PTY operations.
// This is the default backend used in production.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

/// Native PTY backend using `portable_pty`.
///
/// This is the production implementation that creates real pseudo-terminals.
/// It wraps the `portable_pty` crate's functionality.
///
/// # Note on Thread Safety
///
/// The underlying `PtySystem` from portable_pty doesn't implement `Send + Sync`,
/// so we create it fresh for each `open_pty` call. This is fine because
/// `native_pty_system()` is cheap (it just returns a platform-specific struct).
pub struct NativePtyBackend;

impl NativePtyBackend {
    /// Create a new native PTY backend.
    pub fn new() -> Self {
        Self
    }
}

impl Default for NativePtyBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyBackend for NativePtyBackend {
    fn open_pty(&self, cols: u16, rows: u16) -> Result<Box<dyn PtyPair>, String> {
        // Create PtySystem on demand since it doesn't impl Send + Sync
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        Ok(Box::new(NativePtyPair { pair }))
    }
}

/// Native PTY pair wrapping portable_pty types.
struct NativePtyPair {
    pair: portable_pty::PtyPair,
}

impl PtyPair for NativePtyPair {
    fn spawn_shell(
        self: Box<Self>,
        shell: &str,
        cwd: &str,
        env: Vec<(String, String)>,
    ) -> Result<Box<dyn PtyHandle>, String> {
        let mut cmd = CommandBuilder::new(shell);

        // Use login shell to source profile files
        #[cfg(not(target_os = "windows"))]
        cmd.arg("-l");
        #[cfg(target_os = "windows")]
        cmd.arg("-NoLogo");

        cmd.cwd(cwd);

        // Set environment variables
        for (key, value) in env {
            cmd.env(key, value);
        }

        let child = self
            .pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Drop slave - we only need the master side
        // (The child process has the slave end)
        drop(self.pair.slave);

        Ok(Box::new(NativePtyHandle {
            master: Some(self.pair.master),
            child: Some(child),
            writer: None,
        }))
    }
}

/// Native PTY handle wrapping portable_pty types.
struct NativePtyHandle {
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
}

impl PtyHandle for NativePtyHandle {
    fn take_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let master = self
            .master
            .as_ref()
            .ok_or_else(|| "Master already taken".to_string())?;

        master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))
    }

    fn take_writer(&mut self) -> Result<Arc<Mutex<Box<dyn Write + Send>>>, String> {
        if let Some(ref writer) = self.writer {
            return Ok(Arc::clone(writer));
        }

        let master = self
            .master
            .as_ref()
            .ok_or_else(|| "Master already taken".to_string())?;

        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let writer = Arc::new(Mutex::new(writer));
        self.writer = Some(Arc::clone(&writer));
        Ok(writer)
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self
            .master
            .as_ref()
            .ok_or_else(|| "Master already taken".to_string())?;

        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(ref mut child) = self.child {
            child.kill().map_err(|e| format!("Kill failed: {}", e))?;
        }
        Ok(())
    }
}

// ============================================================================
// PTY MANAGER
// ============================================================================

/// Internal entry storing a PTY handle.
struct PtyEntry {
    handle: Box<dyn PtyHandle>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

/// Manages PTY (pseudo-terminal) processes.
///
/// Thread-safe manager that handles:
/// - PTY spawning and lifecycle
/// - Reading/writing to PTY
/// - Resize operations
///
/// # Backend Injection
///
/// By default, uses `NativePtyBackend` for real PTY operations.
/// Tests can inject a mock backend via `PtyManager::with_backend()`.
///
/// # Event Emission
///
/// When a PTY is spawned, a background thread reads from it and emits:
/// - `pty:data:{id}` - When data is available (payload: Vec<u8>)
/// - `pty:exit:{id}` - When the PTY closes (payload: PtyExit)
pub struct PtyManager {
    /// The PTY backend (native or mock).
    backend: Arc<dyn PtyBackend>,

    /// Active PTY sessions.
    ptys: Mutex<HashMap<String, PtyEntry>>,
}

impl PtyManager {
    /// Create a new PtyManager with the default native backend.
    pub fn new() -> Self {
        Self::with_backend(Arc::new(NativePtyBackend::new()))
    }

    /// Create a new PtyManager with a custom backend.
    ///
    /// Use this in tests to inject a mock backend.
    ///
    /// # Arguments
    ///
    /// * `backend` - The PTY backend to use
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let mock = Arc::new(MockPtyBackend::new());
    /// let manager = PtyManager::with_backend(mock);
    /// ```
    pub fn with_backend(backend: Arc<dyn PtyBackend>) -> Self {
        Self {
            backend,
            ptys: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn a new PTY.
    ///
    /// Creates a new pseudo-terminal and starts a shell in it.
    /// A background thread reads from the PTY and emits events to the EventBus.
    ///
    /// If a PTY with the same ID already exists, it is killed first.
    ///
    /// # Arguments
    ///
    /// * `config` - Configuration for the PTY
    /// * `event_bus` - EventBus for emitting PTY events
    ///
    /// # Events
    ///
    /// - `pty:data:{id}` - Emitted when data is available (payload: Vec<u8>)
    /// - `pty:exit:{id}` - Emitted when the PTY closes (payload: PtyExit)
    pub fn spawn(&self, config: PtySpawnConfig, event_bus: Arc<EventBus>) -> Result<(), String> {
        // Kill existing PTY with same ID if present
        {
            let mut map = self.ptys.lock().unwrap();
            if let Some(mut entry) = map.remove(&config.id) {
                let _ = entry.handle.kill();
            }
        }

        // Open PTY through the backend
        let pty_pair = self.backend.open_pty(config.cols, config.rows)?;

        // Build environment variables
        let mut env = Vec::new();
        if let Some(root) = config.workspace_root {
            env.push(("WORKSPACE_ROOT".to_string(), root));
        }

        // Spawn shell
        let mut handle = pty_pair.spawn_shell(&config.shell, &config.cwd, env)?;

        // Get reader and writer
        let reader = handle.take_reader()?;
        let writer = handle.take_writer()?;

        // Store entry
        {
            let mut map = self.ptys.lock().unwrap();
            map.insert(
                config.id.clone(),
                PtyEntry {
                    handle,
                    writer: Arc::clone(&writer),
                },
            );
        }

        // Reader thread - emits pty:data:{id} events
        let read_id = config.id.clone();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        event_bus.emit(&format!("pty:data:{}", read_id), &data);
                    }
                    Err(_) => break,
                }
            }
            // Emit exit event when reader closes
            event_bus.emit(&format!("pty:exit:{}", read_id), &PtyExit { code: None });
        });

        Ok(())
    }

    /// Write data to a PTY.
    ///
    /// # Arguments
    ///
    /// * `id` - The PTY ID
    /// * `data` - The data to write
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY doesn't exist or the write fails.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let map = self.ptys.lock().unwrap();
        let entry = map
            .get(id)
            .ok_or_else(|| format!("No PTY with id {}", id))?;

        let mut writer = entry.writer.lock().unwrap();
        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;

        Ok(())
    }

    /// Resize a PTY.
    ///
    /// # Arguments
    ///
    /// * `id` - The PTY ID
    /// * `cols` - New width in columns
    /// * `rows` - New height in rows
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY doesn't exist or the resize fails.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.ptys.lock().unwrap();
        let entry = map
            .get(id)
            .ok_or_else(|| format!("No PTY with id {}", id))?;

        entry.handle.resize(cols, rows)
    }

    /// Kill a PTY.
    ///
    /// Terminates the PTY process and removes it from the manager.
    /// This is a no-op if the PTY doesn't exist.
    ///
    /// # Arguments
    ///
    /// * `id` - The PTY ID
    pub fn kill(&self, id: &str) {
        let mut map = self.ptys.lock().unwrap();
        if let Some(mut entry) = map.remove(id) {
            let _ = entry.handle.kill();
        }
    }

    /// Check if a PTY exists.
    ///
    /// # Arguments
    ///
    /// * `id` - The PTY ID
    pub fn exists(&self, id: &str) -> bool {
        self.ptys.lock().unwrap().contains_key(id)
    }

    /// Get the number of active PTYs.
    pub fn count(&self) -> usize {
        self.ptys.lock().unwrap().len()
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// MOCK PTY BACKEND (For Testing)
// ============================================================================
//
// This mock backend is defined here (not in test_support) because it
// implements the PtyBackend trait which is defined in this module.
// However, it's only compiled for tests.

#[cfg(test)]
pub mod mock {
    //! Mock PTY backend for testing.
    //!
    //! Provides a fake PTY implementation that doesn't spawn real processes.
    //! Use this to test PtyManager without OS-level PTY operations.
    //!
    //! # Example
    //!
    //! ```rust,ignore
    //! use overseer_core::managers::pty::mock::MockPtyBackend;
    //!
    //! let mock = Arc::new(MockPtyBackend::new());
    //! let manager = PtyManager::with_backend(mock.clone());
    //!
    //! // Configure mock behavior
    //! mock.set_spawn_error("spawn failed");
    //!
    //! // Now spawn will fail
    //! let result = manager.spawn(config, event_bus);
    //! assert!(result.is_err());
    //! ```

    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc::{self, Receiver, Sender};

    /// Mock PTY backend for testing.
    ///
    /// Allows configuring:
    /// - Whether spawn succeeds or fails
    /// - What data the mock PTY "outputs"
    /// - Capturing what data was "written" to the PTY
    pub struct MockPtyBackend {
        /// If set, open_pty returns this error.
        open_error: Mutex<Option<String>>,

        /// If set, spawn_shell returns this error.
        spawn_error: Mutex<Option<String>>,

        /// Data that mock readers will return.
        read_data: Mutex<Vec<u8>>,

        /// Count of open_pty calls.
        open_count: Mutex<usize>,
    }

    impl MockPtyBackend {
        /// Create a new mock PTY backend.
        pub fn new() -> Self {
            Self {
                open_error: Mutex::new(None),
                spawn_error: Mutex::new(None),
                read_data: Mutex::new(Vec::new()),
                open_count: Mutex::new(0),
            }
        }

        /// Configure open_pty to fail with the given error.
        pub fn set_open_error(&self, error: &str) {
            *self.open_error.lock().unwrap() = Some(error.to_string());
        }

        /// Configure spawn_shell to fail with the given error.
        pub fn set_spawn_error(&self, error: &str) {
            *self.spawn_error.lock().unwrap() = Some(error.to_string());
        }

        /// Set the data that readers will return.
        pub fn set_read_data(&self, data: &[u8]) {
            *self.read_data.lock().unwrap() = data.to_vec();
        }

        /// Get the number of times open_pty was called.
        pub fn open_count(&self) -> usize {
            *self.open_count.lock().unwrap()
        }

        /// Clear all configured errors.
        pub fn clear_errors(&self) {
            *self.open_error.lock().unwrap() = None;
            *self.spawn_error.lock().unwrap() = None;
        }
    }

    impl Default for MockPtyBackend {
        fn default() -> Self {
            Self::new()
        }
    }

    impl PtyBackend for MockPtyBackend {
        fn open_pty(&self, cols: u16, rows: u16) -> Result<Box<dyn PtyPair>, String> {
            *self.open_count.lock().unwrap() += 1;

            if let Some(error) = self.open_error.lock().unwrap().as_ref() {
                return Err(error.clone());
            }

            let spawn_error = self.spawn_error.lock().unwrap().clone();
            let read_data = self.read_data.lock().unwrap().clone();

            Ok(Box::new(MockPtyPair {
                cols,
                rows,
                spawn_error,
                read_data,
            }))
        }
    }

    /// Mock PTY pair.
    struct MockPtyPair {
        #[allow(dead_code)]
        cols: u16,
        #[allow(dead_code)]
        rows: u16,
        spawn_error: Option<String>,
        read_data: Vec<u8>,
    }

    impl PtyPair for MockPtyPair {
        fn spawn_shell(
            self: Box<Self>,
            _shell: &str,
            _cwd: &str,
            _env: Vec<(String, String)>,
        ) -> Result<Box<dyn PtyHandle>, String> {
            if let Some(error) = self.spawn_error {
                return Err(error);
            }

            // Create channels for mock I/O
            let (write_tx, _write_rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::channel();

            Ok(Box::new(MockPtyHandle {
                read_data: self.read_data,
                write_sender: write_tx,
                killed: Mutex::new(false),
            }))
        }
    }

    /// Mock PTY handle.
    struct MockPtyHandle {
        read_data: Vec<u8>,
        #[allow(dead_code)]
        write_sender: Sender<Vec<u8>>,
        killed: Mutex<bool>,
    }

    impl PtyHandle for MockPtyHandle {
        fn take_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
            // Return a cursor that reads from our pre-set data
            Ok(Box::new(Cursor::new(std::mem::take(&mut self.read_data))))
        }

        fn take_writer(&mut self) -> Result<Arc<Mutex<Box<dyn Write + Send>>>, String> {
            // Return a mock writer (just discards data)
            Ok(Arc::new(Mutex::new(
                Box::new(std::io::sink()) as Box<dyn Write + Send>
            )))
        }

        fn resize(&self, _cols: u16, _rows: u16) -> Result<(), String> {
            if *self.killed.lock().unwrap() {
                return Err("PTY is dead".to_string());
            }
            Ok(())
        }

        fn kill(&mut self) -> Result<(), String> {
            *self.killed.lock().unwrap() = true;
            Ok(())
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use mock::MockPtyBackend;

    mod pty_manager {
        use super::*;

        #[test]
        fn new_creates_empty_manager() {
            let manager = PtyManager::new();
            assert_eq!(manager.count(), 0);
        }

        #[test]
        fn with_backend_uses_provided_backend() {
            let backend = Arc::new(MockPtyBackend::new());
            // Coerce to Arc<dyn PtyBackend> for with_backend
            let manager = PtyManager::with_backend(Arc::clone(&backend) as Arc<dyn PtyBackend>);

            // Verify the backend is used by checking open_count after spawn attempt
            let config = PtySpawnConfig {
                id: "test".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            let event_bus = Arc::new(EventBus::new());
            let _ = manager.spawn(config, event_bus);

            assert_eq!(backend.open_count(), 1);
        }

        #[test]
        fn spawn_with_mock_backend() {
            let backend = Arc::new(MockPtyBackend::new());
            let manager = PtyManager::with_backend(backend);

            let config = PtySpawnConfig {
                id: "test-pty".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: Some("/workspace".to_string()),
            };

            let event_bus = Arc::new(EventBus::new());
            let result = manager.spawn(config, event_bus);

            assert!(result.is_ok());
            assert!(manager.exists("test-pty"));
            assert_eq!(manager.count(), 1);
        }

        #[test]
        fn spawn_replaces_existing_pty() {
            let backend = Arc::new(MockPtyBackend::new());
            let manager = PtyManager::with_backend(Arc::clone(&backend) as Arc<dyn PtyBackend>);
            let event_bus = Arc::new(EventBus::new());

            let config = PtySpawnConfig {
                id: "test-pty".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            // Spawn first PTY
            manager
                .spawn(config.clone(), Arc::clone(&event_bus))
                .unwrap();
            assert_eq!(manager.count(), 1);

            // Spawn second PTY with same ID
            manager.spawn(config, event_bus).unwrap();
            assert_eq!(manager.count(), 1); // Still 1, not 2
            assert_eq!(backend.open_count(), 2); // But open was called twice
        }

        #[test]
        fn spawn_fails_on_open_error() {
            let backend = Arc::new(MockPtyBackend::new());
            backend.set_open_error("PTY system unavailable");

            let manager = PtyManager::with_backend(backend);

            let config = PtySpawnConfig {
                id: "test".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            let event_bus = Arc::new(EventBus::new());
            let result = manager.spawn(config, event_bus);

            assert!(result.is_err());
            assert!(result.unwrap_err().contains("PTY system unavailable"));
        }

        #[test]
        fn spawn_fails_on_spawn_error() {
            let backend = Arc::new(MockPtyBackend::new());
            backend.set_spawn_error("Shell not found");

            let manager = PtyManager::with_backend(backend);

            let config = PtySpawnConfig {
                id: "test".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/nonexistent".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            let event_bus = Arc::new(EventBus::new());
            let result = manager.spawn(config, event_bus);

            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Shell not found"));
        }

        #[test]
        fn write_to_nonexistent_pty_fails() {
            let manager = PtyManager::new();
            let result = manager.write("nonexistent", b"hello");

            assert!(result.is_err());
            assert!(result.unwrap_err().contains("No PTY with id"));
        }

        #[test]
        fn resize_nonexistent_pty_fails() {
            let manager = PtyManager::new();
            let result = manager.resize("nonexistent", 100, 50);

            assert!(result.is_err());
            assert!(result.unwrap_err().contains("No PTY with id"));
        }

        #[test]
        fn kill_nonexistent_pty_is_noop() {
            let manager = PtyManager::new();
            // Should not panic
            manager.kill("nonexistent");
            assert_eq!(manager.count(), 0);
        }

        #[test]
        fn kill_removes_pty() {
            let backend = Arc::new(MockPtyBackend::new());
            let manager = PtyManager::with_backend(backend);
            let event_bus = Arc::new(EventBus::new());

            let config = PtySpawnConfig {
                id: "test-pty".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            manager.spawn(config, event_bus).unwrap();
            assert_eq!(manager.count(), 1);

            manager.kill("test-pty");
            assert_eq!(manager.count(), 0);
            assert!(!manager.exists("test-pty"));
        }

        #[test]
        fn exists_returns_correct_value() {
            let backend = Arc::new(MockPtyBackend::new());
            let manager = PtyManager::with_backend(backend);
            let event_bus = Arc::new(EventBus::new());

            assert!(!manager.exists("test-pty"));

            let config = PtySpawnConfig {
                id: "test-pty".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            manager.spawn(config, event_bus).unwrap();
            assert!(manager.exists("test-pty"));
        }
    }

    mod mock_backend {
        use super::*;

        #[test]
        fn new_creates_backend() {
            let backend = MockPtyBackend::new();
            assert_eq!(backend.open_count(), 0);
        }

        #[test]
        fn open_pty_increments_count() {
            let backend = MockPtyBackend::new();

            let _ = backend.open_pty(80, 24);
            assert_eq!(backend.open_count(), 1);

            let _ = backend.open_pty(80, 24);
            assert_eq!(backend.open_count(), 2);
        }

        #[test]
        fn set_open_error_causes_failure() {
            let backend = MockPtyBackend::new();
            backend.set_open_error("test error");

            let result = backend.open_pty(80, 24);
            assert!(result.is_err());
        }

        #[test]
        fn clear_errors_resets_state() {
            let backend = MockPtyBackend::new();
            backend.set_open_error("test error");
            backend.clear_errors();

            let result = backend.open_pty(80, 24);
            assert!(result.is_ok());
        }
    }

    mod pty_spawn_config {
        use super::*;

        #[test]
        fn debug_impl() {
            let config = PtySpawnConfig {
                id: "test".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: Some("/workspace".to_string()),
            };

            let debug = format!("{:?}", config);
            assert!(debug.contains("test"));
            assert!(debug.contains("/tmp"));
        }

        #[test]
        fn clone_impl() {
            let config = PtySpawnConfig {
                id: "test".to_string(),
                cwd: "/tmp".to_string(),
                shell: "/bin/sh".to_string(),
                cols: 80,
                rows: 24,
                workspace_root: None,
            };

            let cloned = config.clone();
            assert_eq!(cloned.id, "test");
            assert_eq!(cloned.cols, 80);
        }
    }
}
