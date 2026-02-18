//! Claude CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Manager;

use super::{check_auto_approval, ApprovalCheckResult};
use crate::approvals::ProjectApprovalManager;
use crate::chat_session::ChatSessionManager;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::EventBusState;
use overseer_core::agents::claude::{ClaudeConfig, ClaudeParser};
use overseer_core::event_bus::EventBus;
use overseer_core::shell::AgentExit;
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct AgentProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<ClaudeParser>>,
}

impl Default for AgentProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(ClaudeParser::new())),
        }
    }
}

#[derive(Default)]
pub struct AgentProcessMap {
    processes: Mutex<HashMap<String, AgentProcessEntry>>,
}

/// Build a control_response JSON to send approval to the agent.
fn build_approval_response(request_id: &str, input: &serde_json::Value) -> String {
    let response = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": {
                "behavior": "allow",
                "updatedInput": input
            }
        }
    });
    // Note: No trailing newline - write_stdin uses writeln! which adds one
    response.to_string()
}

/// Start a Claude CLI process for a conversation.
#[tauri::command]
pub fn start_agent(
    app: tauri::AppHandle,
    state: tauri::State<AgentProcessMap>,
    approval_state: tauri::State<ProjectApprovalManager>,
    event_bus_state: tauri::State<EventBusState>,
    conversation_id: String,
    project_name: String,
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
    let mut process = AgentProcess::spawn(spawn_config)?;

    // Take the event receiver out so we can do blocking receives
    // without holding the lock on the process
    let event_receiver = process
        .take_receiver()
        .ok_or_else(|| "Failed to take event receiver".to_string())?;

    // Store the process entry
    let mut entry = AgentProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);
    let parser_arc = Arc::clone(&entry.parser);

    {
        let mut map = state.processes.lock().unwrap();
        map.insert(conversation_id.clone(), entry);
    }

    // Pre-load approval context (but we'll query fresh each time in the loop)
    log::info!(
        "Pre-loading approval context for project: '{}' (len={})",
        project_name,
        project_name.len()
    );
    let _ = approval_state.get_or_load(&project_name);
    let project_name_clone = project_name.clone();

    // Clone EventBus for the thread
    let event_bus = Arc::clone(&event_bus_state.0);

    // Spawn event forwarding thread
    let conv_id = conversation_id.clone();
    let log_file = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        // Helper to flush parser and emit remaining events
        let flush_and_emit =
            |parser_arc: &Arc<Mutex<ClaudeParser>>,
             app: &tauri::AppHandle,
             event_bus: &Arc<EventBus>,
             conv_id: &str,
             process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                let parsed_events = {
                    let mut parser = parser_arc.lock().unwrap();
                    parser.flush()
                };
                for event in parsed_events {
                    let chat_sessions: tauri::State<ChatSessionManager> = app.state();
                    if let Err(err) = chat_sessions.append_event(conv_id, event.clone()) {
                        log::warn!("Failed to persist Claude event for {}: {}", conv_id, err);
                    }
                    event_bus.emit(&format!("agent:event:{}", conv_id), &event);
                }
                process_arc.lock().unwrap().take();
            };

        // Use blocking receive - no polling needed
        while let Ok(event) = event_receiver.recv() {
            match event {
                ProcessEvent::Stdout(line) => {
                    log::debug!("agent stdout [{}]: {}", conv_id, line);
                    log_line(&log_file, "STDOUT", &line);
                    event_bus.emit(&format!("agent:stdout:{}", conv_id), &line);
                    let parsed_events = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.feed(&format!("{line}\n"))
                    };

                    for event in parsed_events {
                        // Check if this is a ToolApproval that we can auto-approve
                        let event_to_emit = match check_auto_approval(
                            &app,
                            &project_name_clone,
                            event,
                            &process_arc,
                            &log_file,
                            build_approval_response,
                        ) {
                            ApprovalCheckResult::AutoApproved(e)
                            | ApprovalCheckResult::NotApproved(e) => e,
                        };

                        let chat_sessions: tauri::State<ChatSessionManager> = app.state();
                        if let Err(err) =
                            chat_sessions.append_event(&conv_id, event_to_emit.clone())
                        {
                            log::warn!(
                                "Failed to persist Claude event for {}: {}",
                                conv_id,
                                err
                            );
                        }
                        event_bus.emit(&format!("agent:event:{}", conv_id), &event_to_emit);
                    }
                }
                ProcessEvent::Stderr(line) => {
                    log::warn!("agent stderr [{}]: {}", conv_id, line);
                    log_line(&log_file, "STDERR", &line);
                    event_bus.emit(&format!("agent:stderr:{}", conv_id), &line);
                }
                ProcessEvent::Exit(exit) => {
                    flush_and_emit(&parser_arc, &app, &event_bus, &conv_id, &process_arc);
                    event_bus.emit(&format!("agent:close:{}", conv_id), &exit);
                    break;
                }
            }
        }

        // Channel closed without Exit event - emit close anyway
        flush_and_emit(&parser_arc, &app, &event_bus, &conv_id, &process_arc);
        event_bus.emit(
            &format!("agent:close:{}", conv_id),
            &AgentExit {
                code: 0,
                signal: None,
            },
        );
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
