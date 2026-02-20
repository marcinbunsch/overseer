//! Gemini agent process manager.
//!
//! Manages Gemini CLI processes, including spawning, stdout parsing,
//! event emission, and lifecycle management.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::agents::gemini::{GeminiConfig, GeminiParser};
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::ChatSessionManager;
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single Gemini process.
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

/// Configuration for starting a Gemini agent.
pub struct GeminiStartConfig {
    pub server_id: String,
    pub gemini_path: String,
    pub prompt: String,
    pub working_dir: String,
    pub session_id: Option<String>,
    pub model_version: Option<String>,
    pub approval_mode: Option<String>,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
}

/// Manages Gemini CLI processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdout parsing via GeminiParser
/// - Event emission via EventBus
#[derive(Default)]
pub struct GeminiAgentManager {
    processes: Mutex<HashMap<String, GeminiProcessEntry>>,
}

impl GeminiAgentManager {
    /// Create a new GeminiAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Gemini CLI process for a server.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: GeminiStartConfig,
        event_bus: Arc<EventBus>,
        chat_sessions: Arc<ChatSessionManager>,
    ) -> Result<(), String> {
        // Stop any existing process for this id first.
        {
            let map = self.processes.lock().unwrap();
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
        let gemini_config = GeminiConfig {
            binary_path: config.gemini_path,
            working_dir: config.working_dir,
            prompt: config.prompt,
            session_id: config.session_id,
            model: config.model_version,
            approval_mode: config.approval_mode,
            shell_prefix: config.agent_shell,
        };

        // Spawn the process
        let mut process = AgentProcess::spawn(gemini_config.build())?;

        // Take the event receiver out
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
            let mut map = self.processes.lock().unwrap();
            map.insert(config.server_id.clone(), entry);
        }

        // Spawn event forwarding thread
        let sid = config.server_id;
        let log_file = Arc::clone(&log_handle);
        std::thread::spawn(move || {
            // Helper to flush parser and emit remaining events
            let flush_and_emit =
                |parser_arc: &Arc<Mutex<GeminiParser>>,
                 chat_sessions: &Arc<ChatSessionManager>,
                 event_bus: &Arc<EventBus>,
                 sid: &str,
                 process_arc: &Arc<Mutex<Option<AgentProcess>>>| {
                    let parsed_events = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.flush()
                    };
                    for event in parsed_events {
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
                        flush_and_emit(
                            &parser_arc,
                            &chat_sessions,
                            &event_bus,
                            &sid,
                            &process_arc,
                        );
                        event_bus.emit(&format!("gemini:close:{}", sid), &exit);
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
                &format!("gemini:close:{}", sid),
                &AgentExit {
                    code: 0,
                    signal: None,
                },
            );
        });

        Ok(())
    }

    /// Gemini headless mode doesn't use stdin, so this is a no-op.
    pub fn write_stdin(&self, _server_id: &str, _data: &str) -> Result<(), String> {
        // No-op: Gemini headless mode doesn't accept stdin input
        Ok(())
    }

    /// Stop a running process.
    pub fn stop(&self, server_id: &str) {
        let map = self.processes.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }
}
