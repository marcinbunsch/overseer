//! Codex CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Emitter;

use crate::logging::{log_line, open_log_file, LogHandle};
use overseer_core::agents::codex::CodexConfig;
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct CodexServerEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
}

impl Default for CodexServerEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct CodexServerMap {
    servers: Mutex<HashMap<String, CodexServerEntry>>,
}

/// Start a `codex app-server` process for a given server_id.
#[tauri::command]
pub fn start_codex_server(
    app: tauri::AppHandle,
    state: tauri::State<CodexServerMap>,
    server_id: String,
    codex_path: String,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    // Stop any existing server for this id first.
    {
        let map = state.servers.lock().unwrap();
        if let Some(entry) = map.get(&server_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }

    // Open log file
    let lid = log_id.as_deref().unwrap_or(&server_id);
    let log_handle = open_log_file(&log_dir, lid);

    // Build config using core
    let config = CodexConfig {
        binary_path: codex_path,
        model: model_version,
        shell_prefix: agent_shell,
    };

    // Spawn the process
    let process = AgentProcess::spawn(config.build())?;

    // Store the process entry
    let mut entry = CodexServerEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);

    {
        let mut map = state.servers.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // Spawn event forwarding thread
    let sid = server_id.clone();
    let log_file = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        loop {
            let event = {
                let guard = process_arc.lock().unwrap();
                if let Some(ref process) = *guard {
                    process.recv()
                } else {
                    break;
                }
            };

            match event {
                Some(ProcessEvent::Stdout(line)) => {
                    log::debug!("codex stdout [{}]: {}", sid, line);
                    log_line(&log_file, "STDOUT", &line);
                    let _ = app.emit(&format!("codex:stdout:{}", sid), line);
                }
                Some(ProcessEvent::Stderr(line)) => {
                    log::warn!("codex stderr [{}]: {}", sid, line);
                    log_line(&log_file, "STDERR", &line);
                }
                Some(ProcessEvent::Exit(exit)) => {
                    let _ = app.emit(&format!("codex:close:{}", sid), exit);
                    process_arc.lock().unwrap().take();
                    break;
                }
                None => {
                    process_arc.lock().unwrap().take();
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Write a line to the codex app-server stdin.
#[tauri::command]
pub fn codex_stdin(
    state: tauri::State<CodexServerMap>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    let entry = map
        .get(&server_id)
        .ok_or_else(|| format!("No codex server for {}", server_id))?;
    log_line(&entry.log_file, "STDIN", &data);

    let guard = entry.process.lock().unwrap();
    if let Some(ref process) = *guard {
        process.write_stdin(&data)
    } else {
        Err(format!("No active stdin for codex server {}", server_id))
    }
}

/// Stop a running codex app-server.
#[tauri::command]
pub fn stop_codex_server(
    state: tauri::State<CodexServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        if let Some(process) = entry.process.lock().unwrap().take() {
            process.kill();
        }
    }
    Ok(())
}
