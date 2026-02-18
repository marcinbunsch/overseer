//! OpenCode HTTP server manager.
//!
//! Manages `opencode serve` processes, including spawning, lifecycle management,
//! and SSE event subscriptions. Unlike other agents that use stdout parsing,
//! OpenCode uses an HTTP REST API for communication.
//!
//! # Why Parsing Stays in TypeScript
//!
//! OpenCode uses an HTTP REST API:
//! 1. Rust spawns `opencode serve` on a port
//! 2. TypeScript uses `@opencode-ai/sdk` to make HTTP calls
//! 3. `session/prompt` returns complete response with `parts` array
//! 4. TypeScript parses the `parts` array into AgentEvents
//!
//! The actual chat content never flows through stdout - it comes via HTTP
//! responses directly to TypeScript. The Rust side only manages the HTTP
//! server process lifecycle and emits `opencode:close:` events when the
//! server stops.

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use crate::agents::opencode::OpenCodeConfig;
use crate::event_bus::EventBus;
use crate::logging::{log_line, open_log_file, LogHandle};
use crate::shell::AgentExit;
use crate::spawn::{AgentProcess, ProcessEvent};

/// Entry for a single OpenCode server.
struct OpenCodeServerEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    port: u16,
    password: String,
    log_file: LogHandle,
    sse_active: Arc<AtomicBool>,
}

impl Default for OpenCodeServerEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            port: 0,
            password: String::new(),
            log_file: Arc::new(Mutex::new(None)),
            sse_active: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Event payload emitted for OpenCode SSE events.
#[derive(Clone, Serialize)]
pub struct OpenCodeEvent {
    pub event_type: String,
    pub payload: serde_json::Value,
}

/// Model info returned from OpenCode server.
#[derive(Clone, Serialize, Deserialize)]
pub struct OpenCodeModel {
    pub id: String,
    pub name: String,
    pub provider_id: String,
}

/// Configuration for starting an OpenCode server.
pub struct OpenCodeStartConfig {
    pub server_id: String,
    pub opencode_path: String,
    pub port: u16,
    pub log_dir: Option<String>,
    pub log_id: Option<String>,
    pub agent_shell: Option<String>,
}

/// Result of starting an OpenCode server.
pub struct OpenCodeServerInfo {
    pub port: u16,
    pub password: String,
}

/// Manages OpenCode serve processes.
///
/// Thread-safe manager that handles:
/// - Server process spawning and lifecycle
/// - Port allocation
/// - SSE event subscriptions
#[derive(Default)]
pub struct OpenCodeAgentManager {
    servers: Mutex<HashMap<String, OpenCodeServerEntry>>,
}

impl OpenCodeAgentManager {
    /// Create a new OpenCodeAgentManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Start an `opencode serve` process for a server.
    ///
    /// Returns the actual port and generated password.
    pub fn start(
        &self,
        config: OpenCodeStartConfig,
        event_bus: Arc<EventBus>,
    ) -> Result<OpenCodeServerInfo, String> {
        // Stop any existing server for this id first.
        {
            let map = self.servers.lock().unwrap();
            if let Some(entry) = map.get(&config.server_id) {
                if let Some(process) = entry.process.lock().unwrap().take() {
                    process.kill();
                }
            }
        }

        // Find an available port
        let actual_port = find_available_port(config.port)?;

        // Generate a random password
        let password = generate_password();

        // Open log file
        let lid = config.log_id.as_deref().unwrap_or(&config.server_id);
        let log_handle = open_log_file(config.log_dir.as_deref(), lid);

        // Build config using core
        let opencode_config = OpenCodeConfig {
            binary_path: config.opencode_path,
            port: actual_port,
            shell_prefix: config.agent_shell,
        };

        // Spawn the process
        let process = AgentProcess::spawn(opencode_config.build())?;

        // Store the process entry
        let mut entry = OpenCodeServerEntry::default();
        entry.log_file = Arc::clone(&log_handle);
        entry.port = actual_port;
        entry.password = password.clone();
        *entry.process.lock().unwrap() = Some(process);

        let process_arc = Arc::clone(&entry.process);

        {
            let mut map = self.servers.lock().unwrap();
            map.insert(config.server_id.clone(), entry);
        }

        // Take the event receiver out
        let event_receiver = {
            let mut guard = process_arc.lock().unwrap();
            guard
                .as_mut()
                .and_then(|p| p.take_receiver())
                .ok_or_else(|| "Failed to take event receiver".to_string())?
        };

        // Spawn event forwarding thread
        let sid = config.server_id;
        let log_file = Arc::clone(&log_handle);
        std::thread::spawn(move || {
            // Use blocking receive - no polling needed
            while let Ok(event) = event_receiver.recv() {
                match event {
                    ProcessEvent::Stdout(line) => {
                        log::debug!("opencode stdout [{}]: {}", sid, line);
                        log_line(&log_file, "STDOUT", &line);
                    }
                    ProcessEvent::Stderr(line) => {
                        log::warn!("opencode stderr [{}]: {}", sid, line);
                        log_line(&log_file, "STDERR", &line);
                    }
                    ProcessEvent::Exit(exit) => {
                        event_bus.emit(&format!("opencode:close:{}", sid), &exit);
                        process_arc.lock().unwrap().take();
                        break;
                    }
                }
            }

            // Channel closed without Exit event - emit close with unknown exit code
            event_bus.emit(
                &format!("opencode:close:{}", sid),
                &AgentExit {
                    code: -1, // Unknown exit code (channel closed without explicit exit)
                    signal: None,
                },
            );
            process_arc.lock().unwrap().take();
        });

        Ok(OpenCodeServerInfo {
            port: actual_port,
            password,
        })
    }

    /// Get the port for a running server.
    pub fn get_port(&self, server_id: &str) -> Result<u16, String> {
        let map = self.servers.lock().unwrap();
        let entry = map
            .get(server_id)
            .ok_or_else(|| format!("No opencode server for {}", server_id))?;
        Ok(entry.port)
    }

    /// Get the password for a running server.
    pub fn get_password(&self, server_id: &str) -> Result<String, String> {
        let map = self.servers.lock().unwrap();
        let entry = map
            .get(server_id)
            .ok_or_else(|| format!("No opencode server for {}", server_id))?;
        Ok(entry.password.clone())
    }

    /// Stop a running server.
    pub fn stop(&self, server_id: &str) {
        let map = self.servers.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            // Stop SSE subscription
            entry.sse_active.store(false, Ordering::SeqCst);
            if let Some(process) = entry.process.lock().unwrap().take() {
                process.kill();
            }
        }
    }

    /// Subscribe to SSE events from the OpenCode server.
    pub fn subscribe_events(
        &self,
        server_id: &str,
        session_id: String,
        event_bus: Arc<EventBus>,
    ) -> Result<(), String> {
        let (port, sse_active) = {
            let map = self.servers.lock().unwrap();
            let entry = map
                .get(server_id)
                .ok_or_else(|| format!("No opencode server for {}", server_id))?;
            (entry.port, Arc::clone(&entry.sse_active))
        };

        // Mark SSE as active
        sse_active.store(true, Ordering::SeqCst);

        let event_name = format!("opencode:event:{}", server_id);
        let sid = server_id.to_string();

        std::thread::spawn(move || {
            let url = format!("http://127.0.0.1:{}/global/event", port);

            // Use a streaming HTTP request
            let response = match ureq::get(&url).set("Accept", "text/event-stream").call() {
                Ok(r) => r,
                Err(e) => {
                    log::error!("Failed to connect to OpenCode SSE: {}", e);
                    return;
                }
            };

            let mut reader = BufReader::new(response.into_reader());
            let mut buffer = String::new();

            while sse_active.load(Ordering::SeqCst) {
                buffer.clear();

                // Read a line
                match reader.read_line(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(_) => {}
                    Err(e) => {
                        if sse_active.load(Ordering::SeqCst) {
                            log::error!("SSE read error for {}: {}", sid, e);
                        }
                        break;
                    }
                }

                let line = buffer.trim();
                if line.is_empty() {
                    continue;
                }

                // Parse SSE data lines
                if let Some(data) = line.strip_prefix("data: ") {
                    // Parse the JSON payload
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        // Extract the actual event from the payload wrapper
                        let payload = json.get("payload").cloned().unwrap_or(json.clone());

                        // Filter by session ID if present in the event
                        let event_session = payload
                            .get("properties")
                            .and_then(|p| p.get("sessionID"))
                            .and_then(|s| s.as_str())
                            .or_else(|| payload.get("sessionID").and_then(|s| s.as_str()));

                        if let Some(event_sid) = event_session {
                            if event_sid != session_id {
                                continue; // Skip events for other sessions
                            }
                        }

                        let event_type = payload
                            .get("type")
                            .and_then(|t| t.as_str())
                            .unwrap_or("unknown")
                            .to_string();

                        let event = OpenCodeEvent {
                            event_type: event_type.clone(),
                            payload,
                        };

                        event_bus.emit(&event_name, &event);

                        // Stop on session completion
                        if event_type == "session.completed" {
                            break;
                        }
                    }
                }
            }

            sse_active.store(false, Ordering::SeqCst);
            log::debug!("OpenCode SSE subscription ended for {}", sid);
        });

        Ok(())
    }

    /// Stop SSE subscription for a server.
    pub fn unsubscribe_events(&self, server_id: &str) {
        let map = self.servers.lock().unwrap();
        if let Some(entry) = map.get(server_id) {
            entry.sse_active.store(false, Ordering::SeqCst);
        }
    }

    /// Fetch available models from a running OpenCode server.
    pub fn get_models(&self, server_id: &str) -> Result<Vec<OpenCodeModel>, String> {
        let port = {
            let map = self.servers.lock().unwrap();
            let entry = map
                .get(server_id)
                .ok_or_else(|| format!("No opencode server for {}", server_id))?;
            entry.port
        };

        // Fetch providers from the server
        let url = format!("http://127.0.0.1:{}/config/providers", port);
        let response = ureq::get(&url)
            .call()
            .map_err(|e| format!("Failed to fetch models: {}", e))?;

        let body: serde_json::Value = response
            .into_json()
            .map_err(|e| format!("Failed to parse models response: {}", e))?;

        let mut models = Vec::new();

        // Parse providers and their models
        if let Some(providers) = body.get("providers").and_then(|p| p.as_array()) {
            for provider in providers {
                let provider_id = provider
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let provider_name = provider
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(provider_id);

                if let Some(provider_models) = provider.get("models").and_then(|m| m.as_object()) {
                    for (model_id, model_info) in provider_models {
                        let model_name = model_info
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(model_id);

                        models.push(OpenCodeModel {
                            id: format!("{}/{}", provider_id, model_id),
                            name: format!("{} - {}", provider_name, model_name),
                            provider_id: provider_id.to_string(),
                        });
                    }
                }
            }
        }

        Ok(models)
    }
}

/// Find an available port starting from the base port.
fn find_available_port(start_port: u16) -> Result<u16, String> {
    for port in start_port..start_port + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("Could not find available port".to_string())
}

/// Generate a random password for the OpenCode server.
fn generate_password() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/// Fetch available models by running `opencode models` CLI command.
///
/// This is a standalone function that doesn't require a running server.
pub fn list_models_from_cli(
    opencode_path: &str,
    agent_shell: Option<&str>,
) -> Result<Vec<OpenCodeModel>, String> {
    use crate::shell::build_login_shell_command;
    use std::process::Stdio;

    let args = vec!["models".to_string()];
    let mut cmd = build_login_shell_command(opencode_path, &args, None, agent_shell)?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run opencode models: {}", e))?;

    if !output.status.success() {
        return Err("opencode models command failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Parse "provider/model" format
        if let Some(slash_idx) = line.find('/') {
            let provider_id = &line[..slash_idx];
            let model_id = &line[slash_idx + 1..];

            models.push(OpenCodeModel {
                id: line.to_string(),
                name: format!("{} - {}", provider_id, model_id),
                provider_id: provider_id.to_string(),
            });
        } else {
            // No provider prefix, use as-is
            models.push(OpenCodeModel {
                id: line.to_string(),
                name: line.to_string(),
                provider_id: String::new(),
            });
        }
    }

    Ok(models)
}
