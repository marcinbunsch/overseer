//! OpenCode HTTP server management.
//!
//! Handles spawning and lifecycle management of `opencode serve` processes.
//! Communication happens via HTTP for commands and SSE for real-time events.
//! SSE is handled in Rust to avoid blocking browser sockets.

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    net::TcpListener,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Emitter;

use super::shared::{build_login_shell_command, AgentExit};
use crate::logging::{log_line, open_log_file, LogHandle};

struct OpenCodeServerEntry {
    child: Arc<Mutex<Option<Child>>>,
    port: u16,
    password: String,
    log_file: LogHandle,
    sse_active: Arc<AtomicBool>,
}

impl Default for OpenCodeServerEntry {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: 0,
            password: String::new(),
            log_file: Arc::new(Mutex::new(None)),
            sse_active: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Event payload emitted to the frontend for OpenCode SSE events.
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

/// Provider info returned from OpenCode server.
#[derive(Clone, Serialize, Deserialize)]
struct OpenCodeProvider {
    id: String,
    name: String,
    models: HashMap<String, serde_json::Value>,
}

#[derive(Default)]
pub struct OpenCodeServerMap {
    servers: Mutex<HashMap<String, OpenCodeServerEntry>>,
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

/// Start an `opencode serve` process for a given server_id.
///
/// The server runs as an HTTP server on the specified port (or finds an available one).
/// stdout/stderr are logged to the log file.
/// Returns a JSON string with the port and password: {"port": 14096, "password": "..."}
#[tauri::command]
pub fn start_opencode_server(
    app: tauri::AppHandle,
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
    opencode_path: String,
    port: u16,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<String, String> {
    // Stop any existing server for this id first.
    {
        let map = state.servers.lock().unwrap();
        if let Some(entry) = map.get(&server_id) {
            if let Some(mut child) = entry.child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    }

    // Find an available port
    let actual_port = find_available_port(port)?;

    // Generate a random password
    let password = generate_password();

    let args = vec![
        "serve".to_string(),
        "--port".to_string(),
        actual_port.to_string(),
        "--cors".to_string(),
        "http://localhost:1420".to_string(),
    ];

    let mut cmd = build_login_shell_command(&opencode_path, &args, None, agent_shell.as_deref())?;
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Note: We intentionally don't set OPENCODE_SERVER_PASSWORD because the
    // OpenCode server doesn't exempt CORS preflight (OPTIONS) requests from
    // authentication, causing 401 errors from the browser. Since the server
    // only listens on 127.0.0.1, running without password is reasonably safe.

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn opencode serve: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture opencode stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture opencode stderr".to_string())?;

    // Open log file if log_dir provided
    let lid = log_id.as_deref().unwrap_or(&server_id);
    let log_handle = open_log_file(&log_dir, lid);

    let mut entry = OpenCodeServerEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    entry.port = actual_port;
    entry.password = password.clone();
    *entry.child.lock().unwrap() = Some(child);

    let child_arc = Arc::clone(&entry.child);

    {
        let mut map = state.servers.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // stdout reader — log only
    let sid_stdout = server_id.clone();
    let log_stdout = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            log::debug!("opencode stdout [{}]: {}", sid_stdout, line);
            log_line(&log_stdout, "STDOUT", &line);
        }
    });

    // stderr reader — log only
    let sid_stderr = server_id.clone();
    let log_stderr = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            log::warn!("opencode stderr [{}]: {}", sid_stderr, line);
            log_line(&log_stderr, "STDERR", &line);
        }
    });

    // exit watcher
    let sid_exit = server_id.clone();
    let app_exit = app.clone();
    std::thread::spawn(move || loop {
        let mut guard = child_arc.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let _ = app_exit.emit(
                        &format!("opencode:close:{}", sid_exit),
                        AgentExit {
                            code: status.code().unwrap_or_default(),
                            signal: None,
                        },
                    );
                    guard.take();
                    break;
                }
                Ok(None) => {}
                Err(_) => {
                    guard.take();
                    break;
                }
            }
        } else {
            break;
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
    });

    // Return JSON with port and password
    Ok(format!(
        r#"{{"port":{}, "password":"{}"}}"#,
        actual_port, password
    ))
}

/// Get the port for a running opencode server.
#[tauri::command]
pub fn get_opencode_port(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<u16, String> {
    let map = state.servers.lock().unwrap();
    let entry = map
        .get(&server_id)
        .ok_or_else(|| format!("No opencode server for {}", server_id))?;
    Ok(entry.port)
}

/// Get the password for a running opencode server.
#[tauri::command]
pub fn get_opencode_password(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<String, String> {
    let map = state.servers.lock().unwrap();
    let entry = map
        .get(&server_id)
        .ok_or_else(|| format!("No opencode server for {}", server_id))?;
    Ok(entry.password.clone())
}

/// Stop a running opencode serve process.
#[tauri::command]
pub fn stop_opencode_server(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        // Stop SSE subscription
        entry.sse_active.store(false, Ordering::SeqCst);
        if let Some(mut child) = entry.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

/// Fetch available models from the OpenCode server.
/// Returns a list of models with their provider info.
#[tauri::command(async)]
pub fn opencode_get_models(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<Vec<OpenCodeModel>, String> {
    let port = {
        let map = state.servers.lock().unwrap();
        let entry = map
            .get(&server_id)
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

/// Subscribe to SSE events from the OpenCode server.
/// Events are emitted to the frontend via Tauri events with the pattern `opencode:event:{server_id}`.
#[tauri::command]
pub fn opencode_subscribe_events(
    app: tauri::AppHandle,
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
    session_id: String,
) -> Result<(), String> {
    let (port, sse_active) = {
        let map = state.servers.lock().unwrap();
        let entry = map
            .get(&server_id)
            .ok_or_else(|| format!("No opencode server for {}", server_id))?;
        (entry.port, Arc::clone(&entry.sse_active))
    };

    // Mark SSE as active
    sse_active.store(true, Ordering::SeqCst);

    let event_name = format!("opencode:event:{}", server_id);
    let sid = server_id.clone();

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

                    if let Err(e) = app.emit(&event_name, event) {
                        log::error!("Failed to emit OpenCode event: {}", e);
                    }

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

/// Stop SSE subscription for an OpenCode server.
#[tauri::command]
pub fn opencode_unsubscribe_events(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        entry.sse_active.store(false, Ordering::SeqCst);
    }
    Ok(())
}

/// Fetch available models by running `opencode models` CLI command.
/// This works without a running server - it uses the CLI directly.
/// Returns a list of models with their provider info.
#[tauri::command(async)]
pub fn opencode_list_models(
    opencode_path: String,
    agent_shell: Option<String>,
) -> Result<Vec<OpenCodeModel>, String> {
    let args = vec!["models".to_string()];
    let mut cmd = build_login_shell_command(&opencode_path, &args, None, agent_shell.as_deref())?;
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
