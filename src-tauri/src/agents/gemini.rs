//! Gemini CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.
//! Uses GeminiParser from overseer-core for NDJSON parsing.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::Manager;

use crate::chat_session::ChatSessionManager;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::EventBusState;
use overseer_core::agents::gemini::{GeminiConfig, GeminiParser};
use overseer_core::event_bus::EventBus;
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct GeminiProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<GeminiParser>>,
}

impl Default for GeminiProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(GeminiParser::new())),
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
    state: tauri::State<'_, Arc<GeminiServerMap>>,
    event_bus_state: tauri::State<EventBusState>,
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
    let log_handle = open_log_file(log_dir.as_deref(), lid);

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
    let mut process = AgentProcess::spawn(config.build())?;

    // Take the event receiver out so we can do blocking receives
    // without holding the lock on the process
    let event_receiver = process
        .take_receiver()
        .ok_or_else(|| "Failed to take event receiver".to_string())?;

    // Store the process entry
    let mut entry = GeminiProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);
    let parser_arc = Arc::clone(&entry.parser);

    {
        let mut map = state.processes.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // Clone EventBus for the thread
    let event_bus = Arc::clone(&event_bus_state.0);

    // Spawn event forwarding thread
    let sid = server_id.clone();
    let log_file = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        // Helper to flush parser and emit remaining events
        let flush_and_emit =
            |parser_arc: &Arc<Mutex<GeminiParser>>,
             app: &tauri::AppHandle,
             event_bus: &Arc<EventBus>,
             sid: &str,
             process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                let parsed_events = {
                    let mut parser = parser_arc.lock().unwrap();
                    parser.flush()
                };
                for event in parsed_events {
                    let chat_sessions: tauri::State<Arc<ChatSessionManager>> = app.state();
                    if let Err(err) = chat_sessions.append_event(sid, event.clone()) {
                        log::warn!("Failed to persist Gemini event for {}: {}", sid, err);
                    }
                    event_bus.emit(&format!("gemini:event:{}", sid), &event);
                }
                process_arc.lock().unwrap().take();
            };

        // Use blocking receive - no polling needed
        while let Ok(event) = event_receiver.recv() {
            match event {
                ProcessEvent::Stdout(line) => {
                    log::debug!("gemini stdout [{}]: {}", sid, line);
                    log_line(&log_file, "STDOUT", &line);

                    // Also emit raw stdout for debugging
                    event_bus.emit(&format!("gemini:stdout:{}", sid), &line);

                    // Parse through GeminiParser
                    let parsed_events = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.feed(&format!("{line}\n"))
                    };

                    // Emit parsed events
                    for event in parsed_events {
                        let chat_sessions: tauri::State<Arc<ChatSessionManager>> = app.state();
                        if let Err(err) = chat_sessions.append_event(&sid, event.clone()) {
                            log::warn!("Failed to persist Gemini event for {}: {}", sid, err);
                        }
                        event_bus.emit(&format!("gemini:event:{}", sid), &event);
                    }
                }
                ProcessEvent::Stderr(line) => {
                    log::warn!("gemini stderr [{}]: {}", sid, line);
                    log_line(&log_file, "STDERR", &line);
                    event_bus.emit(&format!("gemini:stderr:{}", sid), &line);
                }
                ProcessEvent::Exit(exit) => {
                    flush_and_emit(&parser_arc, &app, &event_bus, &sid, &process_arc);
                    event_bus.emit(&format!("gemini:close:{}", sid), &exit);
                    break;
                }
            }
        }

        // Channel closed without Exit event - emit close anyway
        flush_and_emit(&parser_arc, &app, &event_bus, &sid, &process_arc);
        event_bus.emit(
            &format!("gemini:close:{}", sid),
            &overseer_core::shell::AgentExit {
                code: 0,
                signal: None,
            },
        );
    });

    Ok(())
}

/// Placeholder for stdin - Gemini headless mode doesn't use stdin.
#[tauri::command]
pub fn gemini_stdin(
    _state: tauri::State<'_, Arc<GeminiServerMap>>,
    _server_id: String,
    _data: String,
) -> Result<(), String> {
    // No-op: Gemini headless mode doesn't accept stdin input
    Ok(())
}

/// Stop a running gemini process.
#[tauri::command]
pub fn stop_gemini_server(
    state: tauri::State<'_, Arc<GeminiServerMap>>,
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
