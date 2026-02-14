use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::Emitter;

/// Holds the PTY master, child process, and writer handle.
/// The master must be kept alive to prevent the PTY from closing.
struct PtyEntry {
    #[allow(dead_code)]
    master: Box<dyn portable_pty::MasterPty + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

#[derive(Default)]
pub struct PtyMap {
    ptys: Mutex<HashMap<String, PtyEntry>>,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    code: Option<u32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<PtyMap>,
    id: String,
    cwd: String,
    shell: String,
    cols: u16,
    rows: u16,
    workspace_root: Option<String>,
) -> Result<(), String> {
    // Kill existing PTY with same ID if present
    {
        let mut map = state.ptys.lock().unwrap();
        if let Some(mut entry) = map.remove(&id) {
            let _ = entry.child.kill();
        }
    }

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&shell);
    // Use login shell to source profile files
    #[cfg(not(target_os = "windows"))]
    cmd.arg("-l");
    #[cfg(target_os = "windows")]
    cmd.arg("-NoLogo");

    cmd.cwd(&cwd);

    // Set WORKSPACE_ROOT env var for post-create scripts
    if let Some(root) = workspace_root {
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
        let mut map = state.ptys.lock().unwrap();
        map.insert(
            id.clone(),
            PtyEntry {
                master: pair.master,
                child,
                writer: Arc::clone(&writer),
            },
        );
    }

    // Reader thread - emits pty:data:{id} events
    let read_id = id.clone();
    let read_app = app.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let _ = read_app.emit(&format!("pty:data:{}", read_id), data);
                }
                Err(_) => break,
            }
        }
        // Emit exit event when reader closes
        let _ = read_app.emit(&format!("pty:exit:{}", read_id), PtyExit { code: None });
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyMap>, id: String, data: Vec<u8>) -> Result<(), String> {
    let map = state.ptys.lock().unwrap();
    let entry = map
        .get(&id)
        .ok_or_else(|| format!("No PTY with id {}", id))?;

    let mut writer = entry.writer.lock().unwrap();
    writer
        .write_all(&data)
        .map_err(|e| format!("Write failed: {}", e))?;
    writer.flush().map_err(|e| format!("Flush failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<PtyMap>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.ptys.lock().unwrap();
    let entry = map
        .get(&id)
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

#[tauri::command]
pub fn pty_kill(state: tauri::State<PtyMap>, id: String) -> Result<(), String> {
    let mut map = state.ptys.lock().unwrap();
    if let Some(mut entry) = map.remove(&id) {
        let _ = entry.child.kill();
    }
    Ok(())
}
