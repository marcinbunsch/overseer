//! Codex CLI process management.
//!
//! Thin wrapper around overseer-core spawn for Tauri event forwarding.
//! Uses CodexParser from overseer-core for protocol parsing and handles
//! auto-approval of safe commands in Rust.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

use super::{check_auto_approval, ApprovalCheckResult};
use crate::approvals::ProjectApprovalManager;
use crate::logging::{log_line, open_log_file, LogHandle};
use overseer_core::agents::codex::{CodexConfig, CodexParser};
use overseer_core::spawn::{AgentProcess, ProcessEvent};

struct CodexServerEntry {
    process: Arc<Mutex<Option<AgentProcess>>>,
    log_file: LogHandle,
    parser: Arc<Mutex<CodexParser>>,
}

impl Default for CodexServerEntry {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            parser: Arc::new(Mutex::new(CodexParser::new())),
        }
    }
}

/// Build a JSON-RPC response to send approval to the Codex agent.
///
/// Unlike Claude, Codex uses JSON-RPC 2.0 protocol where the response id
/// must match the request id exactly (number or string).
fn build_codex_approval_response(
    request_id: &str,
    _input: &serde_json::Value, // Not used for Codex, but required by shared helper signature
) -> String {
    // Parse the request ID - it could be a number or string in the original request
    // We stringified it, so try to parse back to number if it was originally numeric
    let id_value: serde_json::Value = if request_id.chars().all(|c| c.is_ascii_digit()) {
        serde_json::Value::Number(request_id.parse::<i64>().unwrap_or(0).into())
    } else {
        serde_json::Value::String(request_id.to_string())
    };

    let response = serde_json::json!({
        "id": id_value,
        "result": { "decision": "accept" }
    });
    response.to_string()
}

#[derive(Default)]
pub struct CodexServerMap {
    servers: Mutex<HashMap<String, CodexServerEntry>>,
}

/// Start a `codex app-server` process for a given server_id.
#[tauri::command]
pub fn start_codex_server(
    app: tauri::AppHandle,
    state: tauri::State<CodexServerMap>,
    approval_state: tauri::State<ProjectApprovalManager>,
    server_id: String,
    project_name: String,
    codex_path: String,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    // Stop any existing server for this id first.
    {
        let map = state.servers.lock().unwrap();
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
    let config = CodexConfig {
        binary_path: codex_path,
        model: model_version,
        shell_prefix: agent_shell,
    };

    // Spawn the process
    let process = AgentProcess::spawn(config.build())?;

    // Store the process entry
    let mut entry = CodexServerEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.process.lock().unwrap() = Some(process);

    let process_arc = Arc::clone(&entry.process);
    let parser_arc = Arc::clone(&entry.parser);

    {
        let mut map = state.servers.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // Pre-load approval context
    log::info!(
        "Pre-loading approval context for project: '{}' (len={})",
        project_name,
        project_name.len()
    );
    let _ = approval_state.get_or_load(&project_name);
    let project_name_clone = project_name.clone();

    // Spawn event forwarding thread
    let sid = server_id.clone();
    let log_file = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        loop {
            let event = {
                let guard = process_arc.lock().unwrap();
                if let Some(ref process) = *guard {
                    // Use try_recv() to avoid holding the lock while blocking.
                    // This allows codex_stdin to acquire the lock for writing.
                    process.try_recv()
                } else {
                    break;
                }
            };

            match event {
                Some(ProcessEvent::Stdout(line)) => {
                    log::debug!("codex stdout [{}]: {}", sid, line);
                    log_line(&log_file, "STDOUT", &line);

                    // Also emit raw stdout for JSON-RPC response handling in frontend
                    // (frontend needs to match responses to its pending requests)
                    let _ = app.emit(&format!("codex:stdout:{}", sid), &line);

                    // Parse through CodexParser
                    let (parsed_events, pending_requests) = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.feed(&format!("{line}\n"))
                    };

                    // Handle parsed events
                    for event in parsed_events {
                        // Check if this is a ToolApproval that we can auto-approve
                        let event_to_emit = match check_auto_approval(
                            &app,
                            &project_name_clone,
                            event,
                            &process_arc,
                            &log_file,
                            build_codex_approval_response,
                        ) {
                            ApprovalCheckResult::AutoApproved(e)
                            | ApprovalCheckResult::NotApproved(e) => e,
                        };

                        let _ = app.emit(&format!("codex:event:{}", sid), event_to_emit);
                    }

                    // Handle pending requests that weren't ToolApproval events
                    // (unknown server requests should be auto-accepted)
                    for pending in pending_requests {
                        // Check if we already emitted a ToolApproval for this request
                        // If the method was handled and emitted as ToolApproval, we skip
                        // Otherwise, auto-accept unknown requests
                        let known_methods = [
                            "item/commandExecution/requestApproval",
                            "item/fileChange/requestApproval",
                            "item/tool/requestUserInput",
                        ];
                        if !known_methods.contains(&pending.method.as_str()) {
                            log::warn!("Auto-accepting unknown Codex request: {}", pending.method);
                            let response = build_codex_approval_response(
                                &pending.id.to_string(),
                                &serde_json::Value::Null,
                            );
                            log_line(&log_file, "STDIN", &response);
                            if let Ok(guard) = process_arc.lock() {
                                if let Some(ref process) = *guard {
                                    let _ = process.write_stdin(&response);
                                }
                            }
                        }
                    }
                }
                Some(ProcessEvent::Stderr(line)) => {
                    log::warn!("codex stderr [{}]: {}", sid, line);
                    log_line(&log_file, "STDERR", &line);
                    let _ = app.emit(&format!("codex:stderr:{}", sid), line);
                }
                Some(ProcessEvent::Exit(exit)) => {
                    // Flush parser
                    let (parsed_events, _) = {
                        let mut parser = parser_arc.lock().unwrap();
                        parser.flush()
                    };
                    for event in parsed_events {
                        let _ = app.emit(&format!("codex:event:{}", sid), event);
                    }
                    let _ = app.emit(&format!("codex:close:{}", sid), exit);
                    process_arc.lock().unwrap().take();
                    break;
                }
                None => {
                    // No data available, check if process is still running
                    let still_running = {
                        let guard = process_arc.lock().unwrap();
                        guard
                            .as_ref()
                            .map(|process| process.is_running())
                            .unwrap_or(false)
                    };

                    if !still_running {
                        // Flush parser and emit any remaining events
                        let (parsed_events, _) = {
                            let mut parser = parser_arc.lock().unwrap();
                            parser.flush()
                        };
                        for event in parsed_events {
                            let _ = app.emit(&format!("codex:event:{}", sid), event);
                        }
                        let _ = app.emit(
                            &format!("codex:close:{}", sid),
                            overseer_core::shell::AgentExit {
                                code: 0,
                                signal: None,
                            },
                        );
                        process_arc.lock().unwrap().take();
                        break;
                    }

                    // Small sleep to avoid busy-looping
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    });

    Ok(())
}

/// Write a line to the codex app-server stdin.
#[tauri::command]
pub fn codex_stdin(
    state: tauri::State<CodexServerMap>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    let entry = map
        .get(&server_id)
        .ok_or_else(|| format!("No codex server for {}", server_id))?;
    log_line(&entry.log_file, "STDIN", &data);

    let guard = entry.process.lock().unwrap();
    if let Some(ref process) = *guard {
        process.write_stdin(&data)
    } else {
        Err(format!("No active stdin for codex server {}", server_id))
    }
}

/// Stop a running codex app-server.
#[tauri::command]
pub fn stop_codex_server(
    state: tauri::State<CodexServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.servers.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        if let Some(process) = entry.process.lock().unwrap().take() {
            process.kill();
        }
    }
    Ok(())
}
