//! Codex CLI process management.
//!
//! Handles spawning and communication with the Codex app-server using JSON-RPC.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

use super::shared::{build_login_shell_command, AgentExit};
use crate::logging::{log_line, open_log_file, LogHandle};

struct CodexServerEntry {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    log_file: LogHandle,
}

impl Default for CodexServerEntry {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct CodexServerMap {
    servers: Mutex<HashMap<String, CodexServerEntry>>,
}

/// Start a `codex app-server` process for a given server_id (typically workspace id).
///
/// The process is long-lived and communicates via newline-delimited JSON-RPC on stdio.
/// stdout lines are emitted as `codex:stdout:{server_id}` events.
#[tauri::command]
pub fn start_codex_server(
    app: tauri::AppHandle,
    state: tauri::State<CodexServerMap>,
    server_id: String,
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
            entry.stdin.lock().unwrap().take();
            if let Some(mut child) = entry.child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    }

    let mut args: Vec<String> = vec!["app-server".to_string()];
    if let Some(ref model) = model_version {
        if !model.is_empty() {
            args.push("-c".to_string());
            args.push(format!("model=\"{}\"", model));
        }
    }

    let mut cmd = build_login_shell_command(&codex_path, &args, None, agent_shell.as_deref())?;
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn codex app-server: {}", e))?;

    let child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture codex stdin".to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture codex stderr".to_string())?;

    // Open log file if log_dir provided
    let lid = log_id.as_deref().unwrap_or(&server_id);
    let log_handle = open_log_file(&log_dir, lid);

    let mut entry = CodexServerEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.stdin.lock().unwrap() = Some(child_stdin);
    *entry.child.lock().unwrap() = Some(child);

    let child_arc = Arc::clone(&entry.child);
    let stdin_arc = Arc::clone(&entry.stdin);

    {
        let mut map = state.servers.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // stdout reader — emit each line as a Tauri event
    let sid_stdout = server_id.clone();
    let app_stdout = app.clone();
    let log_stdout = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            log::debug!("codex stdout [{}]: {}", sid_stdout, line);
            log_line(&log_stdout, "STDOUT", &line);
            let _ = app_stdout.emit(&format!("codex:stdout:{}", sid_stdout), line);
        }
    });

    // stderr reader — log only
    let sid_stderr = server_id.clone();
    let log_stderr = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            log::warn!("codex stderr [{}]: {}", sid_stderr, line);
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
                        &format!("codex:close:{}", sid_exit),
                        AgentExit {
                            code: status.code().unwrap_or_default(),
                            signal: None,
                        },
                    );
                    guard.take();
                    stdin_arc.lock().unwrap().take();
                    break;
                }
                Ok(None) => {}
                Err(_) => {
                    guard.take();
                    stdin_arc.lock().unwrap().take();
                    break;
                }
            }
        } else {
            break;
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
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
    let mut guard = entry.stdin.lock().unwrap();
    if let Some(ref mut stdin) = *guard {
        writeln!(stdin, "{}", data)
            .map_err(|e| format!("Failed to write to codex stdin: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush codex stdin: {}", e))?;
        Ok(())
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
        entry.stdin.lock().unwrap().take();
        if let Some(mut child) = entry.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    Ok(())
}
