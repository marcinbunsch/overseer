//! Pi agent process manager.
//!
//! Manages Pi RPC processes, including spawning, stdout parsing,
//! event emission, and lifecycle management.
//!
//! Unlike Gemini (one-shot per message), Pi uses a persistent RPC process
//! that accepts commands via stdin. One process per chat.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::agents::pi::{PiConfig, PiParser};
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::managers::ChatSessionManager;
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single Pi RPC process.
struct PiProcessEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<PiParser>>,
}

impl Default for PiProcessEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(PiParser::new())),
        }
    }
}

/// Configuration for starting a Pi agent.
pub struct PiStartConfig {
    pub server_id: String,
    pub pi_path: String,
    pub working_dir: String,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
}

/// Manages Pi RPC processes.
///
/// Thread-safe manager that handles:
/// - Process spawning and lifecycle
/// - Stdout parsing via PiParser
/// - Event emission via EventBus
/// - Stdin writing for commands
#[derive(Default)]
pub struct PiAgentManager {
    processes: Mutex<HashMap<String, PiProcessEntry>>,
}

impl PiAgentManager {
    /// Create a new PiAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a Pi RPC process for a server.
    ///
    /// The event loop runs in a background thread and emits events to the EventBus.
    pub fn start(
        &self,
        config: PiStartConfig,
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

        // Build config
        let pi_config = PiConfig {
            binary_path: config.pi_path,
            working_dir: config.working_dir,
            shell_prefix: config.agent_shell,
        };

        // Spawn the process
        let mut process = AgentProcess::spawn(pi_config.build())?;

        // Take the event receiver out
        let event_receiver = process
            .take_receiver()
            .ok_or_else(|| "Failed to take event receiver".to_string())?;

        // Store the process entry
        let mut entry = PiProcessEntry::default();
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
                |parser_arc: &Arc<Mutex<PiParser>>,
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
                            log::warn!("Failed to persist Pi event for {}: {}", sid, err);
                        }
                        event_bus.emit(&format!("pi:event:{}", sid), &event);
                    }
                    process_arc.lock().unwrap().take();
                };

            // Use blocking receive
            while let Ok(event) = event_receiver.recv() {
                match event {
                    ProcessEvent::Stdout(line) => {
                        log::debug!("pi stdout [{}]: {}", sid, line);
                        log_line(&log_file, "STDOUT", &line);

                        // Also emit raw stdout for debugging
                        event_bus.emit(&format!("pi:stdout:{}", sid), &line);

                        // Parse through PiParser
                        let parsed_events = {
                            let mut parser = parser_arc.lock().unwrap();
                            parser.feed(&format!("{line}\n"))
                        };

                        // Emit parsed events
                        for event in parsed_events {
                            if let Err(err) = chat_sessions.append_event(&sid, event.clone()) {
                                log::warn!("Failed to persist Pi event for {}: {}", sid, err);
                            }
                            event_bus.emit(&format!("pi:event:{}", sid), &event);
                        }
                    }
                    ProcessEvent::Stderr(line) => {
                        log::warn!("pi stderr [{}]: {}", sid, line);
                        log_line(&log_file, "STDERR", &line);
                        event_bus.emit(&format!("pi:stderr:{}", sid), &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
                        event_bus.emit(&format!("pi:close:{}", sid), &exit);
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close anyway
            flush_and_emit(&parser_arc, &chat_sessions, &event_bus, &sid, &process_arc);
            event_bus.emit(
                &format!("pi:close:{}", sid),
                &AgentExit {
                    code: 0,
                    signal: None,
                },
            );
        });

        Ok(())
    }

    /// Write data to a Pi process's stdin.
    ///
    /// Used to send RPC commands (prompt, abort, set_model, etc.)
    pub fn write_stdin(&self, server_id: &str, data: &str) -> Result<(), String> {
        let map = self.processes.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            if let Some(ref process) = *entry.process.lock().unwrap() {
                process.write_stdin(data)?;
                return Ok(());
            }
        }
        Err(format!("No running Pi process for server_id: {server_id}"))
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
