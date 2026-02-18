//! PTY (pseudo-terminal) manager.
//!
//! Manages pseudo-terminal processes for terminal emulation.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

use crate::event_bus::EventBus;

/// Holds the PTY master, child process, and writer handle.
/// The master must be kept alive to prevent the PTY from closing.
struct PtyEntry {
    #[allow(dead_code)]
    master: Box<dyn portable_pty::MasterPty + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

/// Exit event for a PTY.
#[derive(Clone, Serialize)]
pub struct PtyExit {
    pub code: Option<u32>,
}

/// Configuration for spawning a PTY.
pub struct PtySpawnConfig {
    pub id: String,
    pub cwd: String,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub workspace_root: Option<String>,
}

/// Manages PTY (pseudo-terminal) processes.
///
/// Thread-safe manager that handles:
/// - PTY spawning and lifecycle
/// - Reading/writing to PTY
/// - Resize operations
#[derive(Default)]
pub struct PtyManager {
    ptys: Mutex<HashMap<String, PtyEntry>>,
}

impl PtyManager {
    /// Create a new PtyManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a new PTY.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn spawn(&self, config: PtySpawnConfig, event_bus: Arc<EventBus>) -> Result<(), String> {
        // Kill existing PTY with same ID if present
        {
            let mut map = self.ptys.lock().unwrap();
            if let Some(mut entry) = map.remove(&config.id) {
                let _ = entry.child.kill();
            }
        }

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&config.shell);
        // Use login shell to source profile files
        #[cfg(not(target_os = "windows"))]
        cmd.arg("-l");
        #[cfg(target_os = "windows")]
        cmd.arg("-NoLogo");

        cmd.cwd(&config.cwd);

        // Set WORKSPACE_ROOT env var for post-create scripts
        if let Some(root) = config.workspace_root {
            cmd.env("WORKSPACE_ROOT", root);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Drop slave - we only need the master side
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let writer = Arc::new(Mutex::new(writer));

        // Store entry
        {
            let mut map = self.ptys.lock().unwrap();
            map.insert(
                config.id.clone(),
                PtyEntry {
                    master: pair.master,
                    child,
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
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.ptys.lock().unwrap();
        let entry = map
            .get(id)
            .ok_or_else(|| format!("No PTY with id {}", id))?;

        entry
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;

        Ok(())
    }

    /// Kill a PTY.
    pub fn kill(&self, id: &str) {
        let mut map = self.ptys.lock().unwrap();
        if let Some(mut entry) = map.remove(id) {
            let _ = entry.child.kill();
        }
    }
}
