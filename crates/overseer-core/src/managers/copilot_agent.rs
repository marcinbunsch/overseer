//! Copilot agent process manager.
//!
//! Manages GitHub Copilot CLI processes, including spawning, stdin/stdout handling,
//! event parsing, auto-approval, and lifecycle management.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::agents::copilot::{CopilotConfig, CopilotParser};
use crate::agents::event::AgentEvent;
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::{ChatSessionManager, ProjectApprovalManager};
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single Copilot process.
struct CopilotProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<CopilotParser>>,
}

impl Default for CopilotProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(CopilotParser::new())),
        }
    }
}

/// Configuration for starting a Copilot agent.
pub struct CopilotStartConfig {
    pub server_id: String,
    pub project_name: String,
    pub copilot_path: String,
    pub model_version: Option<String>,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
}

/// Manages Copilot CLI processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdin/stdout communication
/// - Event parsing and emission
/// - Auto-approval of safe commands
#[derive(Default)]
pub struct CopilotAgentManager {
    servers: Mutex<HashMap<String, CopilotProcessEntry>>,
}

impl CopilotAgentManager {
    /// Create a new CopilotAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Copilot CLI process for a server.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: CopilotStartConfig,
        event_bus: Arc<EventBus>,
        approval_manager: Arc<ProjectApprovalManager>,
        chat_sessions: Arc<ChatSessionManager>,
    ) -> Result<(), String> {
        // Stop any existing server for this id first.
        {
            let map = self.servers.lock().unwrap();
            if let Some(entry) = map.get(&config.server_id) {
                if let Some(process) = entry.process.lock().unwrap().take() {
                    process.kill();
                }
            }
        }

        // Open log file
        let lid = config.log_id.as_deref().unwrap_or(&config.server_id);
        let log_handle = open_log_file(config.log_dir.as_deref(), lid);

        // Build config using core
        let copilot_config = CopilotConfig {
            binary_path: config.copilot_path,
            model: config.model_version,
            shell_prefix: config.agent_shell,
        };

        // Spawn the process
        let mut process = AgentProcess::spawn(copilot_config.build())?;

        // Take the event receiver out
        let event_receiver = process
            .take_receiver()
            .ok_or_else(|| "Failed to take event receiver".to_string())?;

        // Store the process entry
        let mut entry = CopilotProcessEntry::default();
        entry.log_file = Arc::clone(&log_handle);
        *entry.process.lock().unwrap() = Some(process);

        let process_arc = Arc::clone(&entry.process);
        let parser_arc = Arc::clone(&entry.parser);

        {
            let mut map = self.servers.lock().unwrap();
            map.insert(config.server_id.clone(), entry);
        }

        // Pre-load approval context
        log::info!(
            "Pre-loading approval context for project: '{}' (len={})",
            config.project_name,
            config.project_name.len()
        );
        let _ = approval_manager.get_or_load(&config.project_name);
        let project_name = config.project_name;

        // Spawn event forwarding thread
        let sid = config.server_id;
        let log_file = Arc::clone(&log_handle);
        std::thread::spawn(move || {
            // Helper to flush parser and emit remaining events
            let flush_and_emit =
                |parser_arc: &Arc<Mutex<CopilotParser>>,
                 chat_sessions: &Arc<ChatSessionManager>,
                 event_bus: &Arc<EventBus>,
                 sid: &str,
                 process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                    let (parsed_events, _) = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.flush()
                    };
                    for event in parsed_events {
                        if let Err(err) = chat_sessions.append_event(sid, event.clone()) {
                            log::warn!("Failed to persist Copilot event for {}: {}", sid, err);
                        }
                        event_bus.emit(&format!("copilot:event:{}", sid), &event);
                    }
                    process_arc.lock().unwrap().take();
                };

            // Use blocking receive - no polling needed
            while let Ok(event) = event_receiver.recv() {
                match event {
                    ProcessEvent::Stdout(line) => {
                        log::debug!("copilot stdout [{}]: {}", sid, line);
                        log_line(&log_file, "STDOUT", &line);

                        // Also emit raw stdout for JSON-RPC response handling in frontend
                        event_bus.emit(&format!("copilot:stdout:{}", sid), &line);

                        // Parse through CopilotParser
                        let (parsed_events, pending_requests) = {
                            let mut parser = parser_arc.lock().unwrap();
                            parser.feed(&format!("{line}\n"))
                        };

                        // Handle parsed events
                        for event in parsed_events {
                            let event_to_emit = check_auto_approval(
                                &approval_manager,
                                &project_name,
                                event,
                                &process_arc,
                                &log_file,
                            );

                            if let Err(err) =
                                chat_sessions.append_event(&sid, event_to_emit.clone())
                            {
                                log::warn!("Failed to persist Copilot event for {}: {}", sid, err);
                            }
                            event_bus.emit(&format!("copilot:event:{}", sid), &event_to_emit);
                        }

                        // Handle pending requests that weren't ToolApproval events
                        for pending in pending_requests {
                            if pending.method == "session/request_permission" {
                                // Auto-accept permission requests
                                let response =
                                    build_approval_response(&pending.id.to_string());
                                log_line(&log_file, "STDIN", &response);
                                if let Ok(guard) = process_arc.lock() {
                                    if let Some(ref process) = *guard {
                                        let _ = process.write_stdin(&response);
                                    }
                                }
                            } else {
                                // Respond with JSON-RPC error for unsupported methods
                                log::warn!(
                                    "Rejecting unsupported Copilot request: {}",
                                    pending.method
                                );
                                let error_response = serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": pending.id,
                                    "error": {
                                        "code": -32601,
                                        "message": "Method not supported"
                                    }
                                });
                                let response = error_response.to_string() + "\n";
                                log_line(&log_file, "STDIN", &response);
                                if let Ok(guard) = process_arc.lock() {
                                    if let Some(ref process) = *guard {
                                        let _ = process.write_stdin(&response);
                                    }
                                }
                            }
                        }
                    }
                    ProcessEvent::Stderr(line) => {
                        log::warn!("copilot stderr [{}]: {}", sid, line);
                        log_line(&log_file, "STDERR", &line);
                        event_bus.emit(&format!("copilot:stderr:{}", sid), &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        flush_and_emit(
                            &parser_arc,
                            &chat_sessions,
                            &event_bus,
                            &sid,
                            &process_arc,
                        );
                        event_bus.emit(&format!("copilot:close:{}", sid), &exit);
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close anyway
            flush_and_emit(
                &parser_arc,
                &chat_sessions,
                &event_bus,
                &sid,
                &process_arc,
            );
            event_bus.emit(
                &format!("copilot:close:{}", sid),
                &AgentExit {
                    code: 0,
                    signal: None,
                },
            );
        });

        Ok(())
    }

    /// Write data to stdin of a running process.
    pub fn write_stdin(&self, server_id: &str, data: &str) -> Result<(), String> {
        let map = self.servers.lock().unwrap();
        let entry = map
            .get(server_id)
            .ok_or_else(|| format!("No copilot server for {}", server_id))?;
        log_line(&entry.log_file, "STDIN", data);

        let guard = entry.process.lock().unwrap();
        if let Some(ref process) = *guard {
            process.write_stdin(data)
        } else {
            Err(format!("No active stdin for copilot server {}", server_id))
        }
    }

    /// Stop a running process.
    pub fn stop(&self, server_id: &str) {
        let map = self.servers.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }
}

/// Build a JSON-RPC 2.0 response to send permission approval to the Copilot agent.
fn build_approval_response(request_id: &str) -> String {
    let id_value: serde_json::Value = if request_id.chars().all(|c| c.is_ascii_digit()) {
        serde_json::Value::Number(request_id.parse::<i64>().unwrap_or(0).into())
    } else {
        serde_json::Value::String(request_id.to_string())
    };

    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id_value,
        "result": { "outcome": { "outcome": "selected", "optionId": "allow_once" } }
    });
    response.to_string()
}

/// Check if a ToolApproval event should be auto-approved based on project settings.
fn check_auto_approval(
    approval_manager: &Arc<ProjectApprovalManager>,
    project_name: &str,
    event: AgentEvent,
    process_arc: &Arc<Mutex<Option<AgentProcess>>>,
    log_file: &LogHandle,
) -> AgentEvent {
    match &event {
        AgentEvent::ToolApproval {
            request_id,
            name,
            input,
            display_input,
            prefixes,
            ..
        } => {
            let prefixes_vec: Vec<String> = prefixes.as_ref().cloned().unwrap_or_default();

            let should_approve =
                approval_manager.should_auto_approve(project_name, name, &prefixes_vec);

            log::info!(
                "Checking approval for {} with prefixes {:?} -> {}",
                name,
                prefixes_vec,
                should_approve
            );

            if should_approve {
                let response = build_approval_response(request_id);
                log_line(log_file, "STDIN", &response);
                log::info!(
                    "Auto-approving {} for project {} (prefixes: {:?})",
                    name,
                    project_name,
                    prefixes_vec
                );

                if let Ok(guard) = process_arc.lock() {
                    if let Some(ref process) = *guard {
                        let _ = process.write_stdin(&response);
                    }
                }

                AgentEvent::ToolApproval {
                    request_id: request_id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                    display_input: display_input.clone(),
                    prefixes: prefixes.clone(),
                    auto_approved: true,
                    is_processed: None,
                }
            } else {
                event
            }
        }
        _ => event,
    }
}
