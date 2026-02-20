//! Claude agent process manager.
//!
//! Manages Claude CLI processes, including spawning, stdin/stdout handling,
//! event parsing, auto-approval, and lifecycle management.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::Utc;
use uuid::Uuid;

use crate::agents::claude::{ClaudeConfig, ClaudeParser};
use crate::agents::event::AgentEvent;
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::{ChatSessionManager, ProjectApprovalManager};
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single Claude process.
struct ClaudeProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<ClaudeParser>>,
}

impl Default for ClaudeProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(ClaudeParser::new())),
        }
    }
}

/// Configuration for starting a Claude agent.
pub struct ClaudeStartConfig {
    pub conversation_id: String,
    pub project_name: String,
    pub prompt: String,
    pub working_dir: String,
    pub agent_path: String,
    pub session_id: Option<String>,
    pub model_version: Option<String>,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub permission_mode: Option<String>,
    pub agent_shell: Option<String>,
}

/// Manages Claude CLI processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdin/stdout communication
/// - Event parsing and emission
/// - Auto-approval of safe commands
#[derive(Default)]
pub struct ClaudeAgentManager {
    processes: Mutex<HashMap<String, ClaudeProcessEntry>>,
}

impl ClaudeAgentManager {
    /// Create a new ClaudeAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Claude CLI process for a conversation.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: ClaudeStartConfig,
        event_bus: Arc<EventBus>,
        approval_manager: Arc<ProjectApprovalManager>,
        chat_sessions: Arc<ChatSessionManager>,
    ) -> Result<(), String> {
        // Stop any existing process for this conversation first.
        {
            let map = self.processes.lock().unwrap();
            if let Some(entry) = map.get(&config.conversation_id) {
                if let Some(process) = entry.process.lock().unwrap().take() {
                    process.kill();
                }
            }
        }

        // Open log file
        let lid = config.log_id.as_deref().unwrap_or(&config.conversation_id);
        let log_handle = open_log_file(config.log_dir.as_deref(), lid);

        // Build config using core
        let claude_config = ClaudeConfig {
            binary_path: config.agent_path,
            working_dir: config.working_dir,
            prompt: config.prompt.clone(),
            session_id: config.session_id,
            model: config.model_version,
            permission_mode: config.permission_mode,
            shell_prefix: config.agent_shell,
        };

        // Log the initial prompt
        let spawn_config = claude_config.build();
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
        let mut entry = ClaudeProcessEntry::default();
        entry.log_file = Arc::clone(&log_handle);
        *entry.process.lock().unwrap() = Some(process);

        let process_arc = Arc::clone(&entry.process);
        let parser_arc = Arc::clone(&entry.parser);

        {
            let mut map = self.processes.lock().unwrap();
            map.insert(config.conversation_id.clone(), entry);
        }

        // Pre-load approval context (but we'll query fresh each time in the loop)
        log::info!(
            "Pre-loading approval context for project: '{}' (len={})",
            config.project_name,
            config.project_name.len()
        );
        let _ = approval_manager.get_or_load(&config.project_name);
        let project_name = config.project_name;

        // Spawn event forwarding thread
        let conv_id = config.conversation_id;
        let log_file = Arc::clone(&log_handle);
        std::thread::spawn(move || {
            // Helper to persist and emit an event with seq wrapper
            let persist_and_emit = |chat_sessions: &Arc<ChatSessionManager>,
                                    event_bus: &Arc<EventBus>,
                                    conv_id: &str,
                                    event: AgentEvent| {
                match chat_sessions.append_event_with_seq(conv_id, event.clone()) {
                    Ok(seq) => {
                        // Emit with seq wrapper for reliable catch-up
                        // Use SeqEvent to ensure consistent format with HTTP endpoints
                        let seq_event = crate::persistence::SeqEvent { seq, event };
                        event_bus.emit(&format!("agent:event:{}", conv_id), &seq_event);
                    }
                    Err(err) => {
                        log::warn!("Failed to persist Claude event for {}: {}", conv_id, err);
                        // Still emit without seq (fallback for unregistered sessions)
                        event_bus.emit(&format!("agent:event:{}", conv_id), &event);
                    }
                }
            };

            // Helper to flush parser and emit remaining events
            let flush_and_emit =
                |parser_arc: &Arc<Mutex<ClaudeParser>>,
                 chat_sessions: &Arc<ChatSessionManager>,
                 event_bus: &Arc<EventBus>,
                 conv_id: &str,
                 process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                    let parsed_events = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.flush()
                    };
                    for event in parsed_events {
                        persist_and_emit(chat_sessions, event_bus, conv_id, event);
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
                            let event_to_emit = check_auto_approval(
                                &approval_manager,
                                &project_name,
                                event,
                                &process_arc,
                                &log_file,
                            );

                            persist_and_emit(
                                &chat_sessions,
                                &event_bus,
                                &conv_id,
                                event_to_emit,
                            );
                        }
                    }
                    ProcessEvent::Stderr(line) => {
                        log::warn!("agent stderr [{}]: {}", conv_id, line);
                        log_line(&log_file, "STDERR", &line);
                        event_bus.emit(&format!("agent:stderr:{}", conv_id), &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        flush_and_emit(
                            &parser_arc,
                            &chat_sessions,
                            &event_bus,
                            &conv_id,
                            &process_arc,
                        );
                        event_bus.emit(&format!("agent:close:{}", conv_id), &exit);
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close anyway
            flush_and_emit(
                &parser_arc,
                &chat_sessions,
                &event_bus,
                &conv_id,
                &process_arc,
            );
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

    /// Write data to stdin of a running process.
    pub fn write_stdin(&self, conversation_id: &str, data: &str) -> Result<(), String> {
        let map = self.processes.lock().unwrap();
        let entry = map
            .get(conversation_id)
            .ok_or_else(|| format!("No process for conversation {}", conversation_id))?;
        log_line(&entry.log_file, "STDIN", data);

        let guard = entry.process.lock().unwrap();
        if let Some(ref process) = *guard {
            process.write_stdin(data)
        } else {
            Err(format!(
                "No active process for conversation {}",
                conversation_id
            ))
        }
    }

    /// Stop a running process.
    pub fn stop(&self, conversation_id: &str) {
        let map = self.processes.lock().unwrap();
        if let Some(entry) = map.get(conversation_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.stop();
            }
        }
    }

    /// List all running conversation IDs.
    pub fn list_running(&self) -> Vec<String> {
        let map = self.processes.lock().unwrap();
        map.iter()
            .filter(|(_, entry)| entry.process.lock().unwrap().is_some())
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Check if a process is running for a conversation.
    pub fn is_running(&self, conversation_id: &str) -> bool {
        let map = self.processes.lock().unwrap();
        if let Some(entry) = map.get(conversation_id) {
            entry.process.lock().unwrap().is_some()
        } else {
            false
        }
    }

    /// Send a message to a conversation.
    ///
    /// If a process is already running, sends the message via stdin.
    /// Otherwise, starts a new process with the given config.
    ///
    /// This is the unified entry point for all message sending - the backend
    /// decides whether to start a new process or continue an existing one.
    ///
    /// The user message is emitted as an event so all connected clients
    /// (both Tauri windows and web clients) can update their state.
    pub fn send_message(
        &self,
        config: ClaudeStartConfig,
        event_bus: Arc<EventBus>,
        approval_manager: Arc<ProjectApprovalManager>,
        chat_sessions: Arc<ChatSessionManager>,
    ) -> Result<(), String> {
        // Create and emit user message event so all clients can see it.
        // Mark as "system" so UI knows to hide it (the actual user message
        // was already persisted by the frontend before calling send_message).
        let user_message = AgentEvent::UserMessage {
            id: Uuid::new_v4().to_string(),
            content: config.prompt.clone(),
            timestamp: Utc::now(),
            meta: Some(serde_json::json!({ "type": "system", "label": "System" })),
        };

        // Persist the user message and emit with seq wrapper
        match chat_sessions.append_event_with_seq(&config.conversation_id, user_message.clone()) {
            Ok(seq) => {
                // Use SeqEvent to ensure consistent flattened format with HTTP endpoints
                let seq_event = crate::persistence::SeqEvent {
                    seq,
                    event: user_message.clone(),
                };
                event_bus.emit(
                    &format!("agent:event:{}", config.conversation_id),
                    &seq_event,
                );
            }
            Err(err) => {
                log::warn!(
                    "Failed to persist user message for {}: {}",
                    config.conversation_id,
                    err
                );
                // Fallback: emit without seq
                event_bus.emit(
                    &format!("agent:event:{}", config.conversation_id),
                    &user_message,
                );
            }
        }

        // Check if we have a running process for this conversation
        if self.is_running(&config.conversation_id) {
            // Format the prompt as a user message envelope and send via stdin
            let envelope = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": config.prompt
                }
            });
            log::info!(
                "Sending follow-up via stdin for conversation {}",
                config.conversation_id
            );
            self.write_stdin(&config.conversation_id, &envelope.to_string())
        } else {
            // No running process - start a new one
            log::info!(
                "Starting new process for conversation {}",
                config.conversation_id
            );
            self.start(config, event_bus, approval_manager, chat_sessions)
        }
    }
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

            // Query the approval manager to check if this should auto-approve
            let should_approve =
                approval_manager.should_auto_approve(project_name, name, &prefixes_vec);

            log::info!(
                "Checking approval for {} with prefixes {:?} -> {}",
                name,
                prefixes_vec,
                should_approve
            );

            if should_approve {
                // Auto-approve: send response directly to agent
                let response = build_approval_response(request_id, input);
                log_line(log_file, "STDIN", &response);
                log::info!(
                    "Auto-approving {} for project {} (prefixes: {:?})",
                    name,
                    project_name,
                    prefixes_vec
                );

                // Write approval to agent stdin
                if let Ok(guard) = process_arc.lock() {
                    if let Some(ref process) = *guard {
                        let _ = process.write_stdin(&response);
                    }
                }

                // Return event with auto_approved = true
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
                // Not auto-approved, pass through unchanged
                event
            }
        }
        // Non-ToolApproval events pass through unchanged
        _ => event,
    }
}
