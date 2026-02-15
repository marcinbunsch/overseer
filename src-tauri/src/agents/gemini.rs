//! Gemini CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Emitter;

use crate::logging::{log_line, open_log_file, LogHandle};
use overseer_core::agents::gemini::GeminiConfig;
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct GeminiProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
}

impl Default for GeminiProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct GeminiServerMap {
    processes: Mutex<HashMap<String, GeminiProcessEntry>>,
}

/// Start a `gemini` process for a given server_id.
#[tauri::command]
pub fn start_gemini_server(
    app: tauri::AppHandle,
    state: tauri::State<GeminiServerMap>,
    server_id: String,
    gemini_path: String,
    prompt: String,
    working_dir: String,
    session_id: Option<String>,
    model_version: Option<String>,
    approval_mode: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    // Stop any existing process for this id first.
    {
        let map = state.processes.lock().unwrap();
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
    let config = GeminiConfig {
        binary_path: gemini_path,
        working_dir,
        prompt,
        session_id,
        model: model_version,
        approval_mode,
        shell_prefix: agent_shell,
    };

    // Spawn the process
    let process = AgentProcess::spawn(config.build())?;

    // Store the process entry
    let mut entry = GeminiProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);

    {
        let mut map = state.processes.lock().unwrap();
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
                    log::debug!("gemini stdout [{}]: {}", sid, line);
                    log_line(&log_file, "STDOUT", &line);
                    let _ = app.emit(&format!("gemini:stdout:{}", sid), line);
                }
                Some(ProcessEvent::Stderr(line)) => {
                    log::warn!("gemini stderr [{}]: {}", sid, line);
                    log_line(&log_file, "STDERR", &line);
                    let _ = app.emit(&format!("gemini:stderr:{}", sid), line);
                }
                Some(ProcessEvent::Exit(exit)) => {
                    let _ = app.emit(&format!("gemini:close:{}", sid), exit);
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

/// Placeholder for stdin - Gemini headless mode doesn't use stdin.
#[tauri::command]
pub fn gemini_stdin(
    _state: tauri::State<GeminiServerMap>,
    _server_id: String,
    _data: String,
) -> Result<(), String> {
    // No-op: Gemini headless mode doesn't accept stdin input
    Ok(())
}

/// Stop a running gemini process.
#[tauri::command]
pub fn stop_gemini_server(
    state: tauri::State<GeminiServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        if let Some(process) = entry.process.lock().unwrap().take() {
            process.kill();
        }
    }
    Ok(())
}
