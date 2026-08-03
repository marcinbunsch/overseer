//! Hermes agent process manager.
//!
//! Manages Hermes CLI ACP processes (`hermes acp`), including spawning,
//! stdin/stdout handling, event parsing, auto-approval, replay suppression
//! for session resume, and lifecycle management.
//!
//! # Replay suppression
//!
//! Hermes supports resuming a session across process restarts via ACP
//! `session/load`, which replays the entire prior transcript as
//! `session/update` notifications before the load response. Overseer already
//! has that history persisted, so replayed events must not be re-persisted or
//! re-emitted to the frontend. The frontend toggles `set_replay_suppression`
//! around the `session/load` call: the flag is set before the request is
//! written to stdin (so every replayed line is parsed while it is on) and
//! cleared only after the load response arrived (which the server sends after
//! the replay completes). Raw stdout lines are always forwarded — the
//! frontend needs them to resolve its pending JSON-RPC requests, including
//! the load response itself.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use crate::agents::event::AgentEvent;
use crate::agents::hermes::{AcpParser, HermesConfig};
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::{ChatSessionManager, ProjectApprovalManager};
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single Hermes process.
struct HermesProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<AcpParser>>,
    suppress_replay: Arc<AtomicBool>,
}

impl Default for HermesProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(AcpParser::new())),
            suppress_replay: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Configuration for starting a Hermes agent.
pub struct HermesStartConfig {
    pub server_id: String,
    pub project_name: String,
    pub hermes_path: String,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
}

/// Manages Hermes CLI processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdin/stdout communication
/// - Event parsing and emission
/// - Auto-approval of safe commands
/// - Replay suppression during session/load
#[derive(Default)]
pub struct HermesAgentManager {
    servers: Mutex<HashMap<String, HermesProcessEntry>>,
}

impl HermesAgentManager {
    /// Create a new HermesAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Hermes CLI ACP process for a server.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: HermesStartConfig,
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
        let hermes_config = HermesConfig {
            binary_path: config.hermes_path,
            shell_prefix: config.agent_shell,
        };

        // Spawn the process
        let mut process = AgentProcess::spawn(hermes_config.build())?;

        // Take the event receiver out
        let event_receiver = process
            .take_receiver()
            .ok_or_else(|| "Failed to take event receiver".to_string())?;

        // Store the process entry
        let mut entry = HermesProcessEntry::default();
        entry.log_file = Arc::clone(&log_handle);
        *entry.process.lock().unwrap() = Some(process);

        let process_arc = Arc::clone(&entry.process);
        let parser_arc = Arc::clone(&entry.parser);
        let suppress_replay = Arc::clone(&entry.suppress_replay);

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
                |parser_arc: &Arc<Mutex<AcpParser>>,
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
                            log::warn!("Failed to persist Hermes event for {}: {}", sid, err);
                        }
                        event_bus.emit(&format!("hermes:event:{}", sid), &event);
                    }
                    process_arc.lock().unwrap().take();
                };

            // Use blocking receive - no polling needed
            while let Ok(event) = event_receiver.recv() {
                match event {
                    ProcessEvent::Stdout(line) => {
                        log::debug!("hermes stdout [{}]: {}", sid, line);
                        log_line(&log_file, "STDOUT", &line);

                        // Also emit raw stdout for JSON-RPC response handling in frontend
                        event_bus.emit(&format!("hermes:stdout:{}", sid), &line);

                        // Parse through AcpParser
                        let (parsed_events, pending_requests) = {
                            let mut parser = parser_arc.lock().unwrap();
                            parser.feed(&format!("{line}\n"))
                        };

                        // During session/load replay, drop parsed events: the
                        // frontend already has this history persisted. Raw
                        // stdout was still emitted above.
                        let suppressed = suppress_replay.load(Ordering::SeqCst);

                        if !suppressed {
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
                                    log::warn!(
                                        "Failed to persist Hermes event for {}: {}",
                                        sid,
                                        err
                                    );
                                }
                                event_bus.emit(&format!("hermes:event:{}", sid), &event_to_emit);
                            }
                        }

                        // Reject unsupported server-initiated requests.
                        // Permission requests are answered either by
                        // check_auto_approval above or by the frontend UI —
                        // never unconditionally here.
                        for pending in pending_requests {
                            if pending.method != "session/request_permission" {
                                log::warn!("Rejecting unsupported Hermes request: {}", pending.method);
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
                        log::warn!("hermes stderr [{}]: {}", sid, line);
                        log_line(&log_file, "STDERR", &line);
                        event_bus.emit(&format!("hermes:stderr:{}", sid), &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
                        event_bus.emit(&format!("hermes:close:{}", sid), &exit);
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close anyway
            flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
            event_bus.emit(
                &format!("hermes:close:{}", sid),
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
            .ok_or_else(|| format!("No hermes server for {}", server_id))?;
        log_line(&entry.log_file, "STDIN", data);

        let guard = entry.process.lock().unwrap();
        if let Some(ref process) = *guard {
            process.write_stdin(data)
        } else {
            Err(format!("No active stdin for hermes server {}", server_id))
        }
    }

    /// Toggle replay suppression for a running process.
    ///
    /// The frontend sets this before sending `session/load` and clears it
    /// after the load response resolves. See the module docs for why this
    /// ordering is race-free.
    pub fn set_replay_suppression(&self, server_id: &str, suppress: bool) -> Result<(), String> {
        let map = self.servers.lock().unwrap();
        let entry = map
            .get(server_id)
            .ok_or_else(|| format!("No hermes server for {}", server_id))?;
        entry.suppress_replay.store(suppress, Ordering::SeqCst);
        Ok(())
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

    /// Insert an empty entry for tests that need one without spawning a process.
    #[cfg(test)]
    fn insert_test_entry(&self, server_id: &str) -> Arc<AtomicBool> {
        let entry = HermesProcessEntry::default();
        let flag = Arc::clone(&entry.suppress_replay);
        self.servers
            .lock()
            .unwrap()
            .insert(server_id.to_string(), entry);
        flag
    }
}

/// Build a JSON-RPC 2.0 response to send permission approval to the Hermes agent.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_replay_suppression_unknown_server_errors() {
        let manager = HermesAgentManager::new();
        let result = manager.set_replay_suppression("missing-chat", true);
        assert!(result.is_err());
    }

    #[test]
    fn set_replay_suppression_toggles_flag() {
        let manager = HermesAgentManager::new();
        let flag = manager.insert_test_entry("chat-1");
        assert!(!flag.load(Ordering::SeqCst));

        manager.set_replay_suppression("chat-1", true).unwrap();
        assert!(flag.load(Ordering::SeqCst));

        manager.set_replay_suppression("chat-1", false).unwrap();
        assert!(!flag.load(Ordering::SeqCst));
    }

    #[test]
    fn build_approval_response_numeric_and_string_ids() {
        let numeric = build_approval_response("5");
        assert!(numeric.contains(r#""id":5"#));
        assert!(numeric.contains(r#""optionId":"allow_once""#));

        let string = build_approval_response("req-abc");
        assert!(string.contains(r#""id":"req-abc""#));
    }
}
