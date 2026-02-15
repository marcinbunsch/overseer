//! Claude CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Emitter;

use crate::logging::{log_line, open_log_file, LogHandle};
use overseer_core::agents::claude::ClaudeConfig;
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct AgentProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
}

impl Default for AgentProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct AgentProcessMap {
    processes: Mutex<HashMap<String, AgentProcessEntry>>,
}

/// Start a Claude CLI process for a conversation.
#[tauri::command]
pub fn start_agent(
    app: tauri::AppHandle,
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
    prompt: String,
    working_dir: String,
    agent_path: String,
    session_id: Option<String>,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    permission_mode: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    // Stop any existing process for this conversation first.
    {
        let map = state.processes.lock().unwrap();
        if let Some(entry) = map.get(&conversation_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }

    // Open log file
    let lid = log_id.as_deref().unwrap_or(&conversation_id);
    let log_handle = open_log_file(log_dir.as_deref(), lid);

    // Build config using core
    let config = ClaudeConfig {
        binary_path: agent_path,
        working_dir,
        prompt: prompt.clone(),
        session_id,
        model: model_version,
        permission_mode,
        shell_prefix: agent_shell,
    };

    // Log the initial prompt
    let spawn_config = config.build();
    if let Some(ref initial) = spawn_config.initial_stdin {
        log_line(&log_handle, "STDIN", initial);
    }

    // Spawn the process
    let process = AgentProcess::spawn(spawn_config)?;

    // Store the process entry
    let mut entry = AgentProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);

    {
        let mut map = state.processes.lock().unwrap();
        map.insert(conversation_id.clone(), entry);
    }

    // Spawn event forwarding thread
    let conv_id = conversation_id.clone();
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
                    log::debug!("agent stdout [{}]: {}", conv_id, line);
                    log_line(&log_file, "STDOUT", &line);
                    let _ = app.emit(&format!("agent:stdout:{}", conv_id), line);
                }
                Some(ProcessEvent::Stderr(line)) => {
                    log::warn!("agent stderr [{}]: {}", conv_id, line);
                    log_line(&log_file, "STDERR", &line);
                    let _ = app.emit(&format!("agent:stderr:{}", conv_id), line);
                }
                Some(ProcessEvent::Exit(exit)) => {
                    let _ = app.emit(&format!("agent:close:{}", conv_id), exit);
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

/// Write data to a Claude CLI process stdin.
#[tauri::command]
pub fn agent_stdin(
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    let entry = map
        .get(&conversation_id)
        .ok_or_else(|| format!("No process for conversation {}", conversation_id))?;
    log_line(&entry.log_file, "STDIN", &data);

    let guard = entry.process.lock().unwrap();
    if let Some(ref process) = *guard {
        process.write_stdin(&data)
    } else {
        Err(format!(
            "No active process for conversation {}",
            conversation_id
        ))
    }
}

/// Stop a running Claude CLI process.
#[tauri::command]
pub fn stop_agent(
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    if let Some(entry) = map.get(&conversation_id) {
        if let Some(process) = entry.process.lock().unwrap().take() {
            process.stop();
        }
    }
    Ok(())
}

/// List all running Claude CLI conversations.
#[tauri::command]
pub fn list_running(state: tauri::State<AgentProcessMap>) -> Vec<String> {
    let map = state.processes.lock().unwrap();
    map.iter()
        .filter(|(_, entry)| entry.process.lock().unwrap().is_some())
        .map(|(id, _)| id.clone())
        .collect()
}
