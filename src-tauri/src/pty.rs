//! PTY Tauri commands.
//!
//! Thin wrapper around overseer-core's PtyManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::PtySpawnConfig;
use std::sync::Arc;

/// Spawn a new PTY.
#[tauri::command]
pub fn pty_spawn(
    context_state: tauri::State<OverseerContextState>,
    id: String,
    cwd: String,
    shell: String,
    cols: u16,
    rows: u16,
    workspace_root: Option<String>,
) -> Result<(), String> {
    let config = PtySpawnConfig {
        id,
        cwd,
        shell,
        cols,
        rows,
        workspace_root,
    };

    context_state
        .0
        .pty_manager
        .spawn(config, Arc::clone(&context_state.0.event_bus))
}

/// Write data to a PTY.
#[tauri::command]
pub fn pty_write(
    context_state: tauri::State<OverseerContextState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    context_state.0.pty_manager.write(&id, &data)
}

/// Resize a PTY.
#[tauri::command]
pub fn pty_resize(
    context_state: tauri::State<OverseerContextState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    context_state.0.pty_manager.resize(&id, cols, rows)
}

/// Kill a PTY.
#[tauri::command]
pub fn pty_kill(context_state: tauri::State<OverseerContextState>, id: String) -> Result<(), String> {
    context_state.0.pty_manager.kill(&id);
    Ok(())
}
