//! Claude CLI process management.
//!
//! Handles spawning and communication with the Claude CLI using stream-json format.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

use super::shared::{prepare_path_env, AgentExit};
use crate::logging::{log_line, open_log_file, LogHandle};

struct AgentProcessEntry {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    log_file: LogHandle,
}

impl Default for AgentProcessEntry {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct AgentProcessMap {
    processes: Mutex<HashMap<String, AgentProcessEntry>>,
}

/// Start a Claude CLI process for a conversation.
///
/// Spawns `claude` with stream-json format and sends the initial prompt via stdin.
/// stdout/stderr lines are emitted as `agent:stdout:{id}` and `agent:stderr:{id}` events.
#[tauri::command]
pub fn start_agent(
    app: tauri::AppHandle,
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
    prompt: String,
    working_dir: String,
    agent_path: String,
    session_id: Option<String>,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    permission_mode: Option<String>,
) -> Result<(), String> {
    // Stop any existing process for this conversation first.
    {
        let map = state.processes.lock().unwrap();
        if let Some(entry) = map.get(&conversation_id) {
            entry.stdin.lock().unwrap().take();
            if let Some(mut child) = entry.child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    }

    let mode = permission_mode.unwrap_or_else(|| "default".to_string());
    let mut args = vec![
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-prompt-tool".to_string(),
        "stdio".to_string(),
        "--permission-mode".to_string(),
        mode,
    ];
    if let Some(ref model) = model_version {
        if !model.is_empty() {
            args.push("--model".to_string());
            args.push(model.clone());
        }
    }
    if let Some(id) = session_id {
        args.push("--resume".to_string());
        args.push(id);
    }

    let mut cmd = Command::new(&agent_path);
    cmd.args(&args)
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    prepare_path_env(&mut cmd, &agent_path);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture stdin".to_string())?;

    // Open log file if log_dir provided
    let lid = log_id.as_deref().unwrap_or(&conversation_id);
    let log_handle = open_log_file(&log_dir, lid);

    // Send the initial prompt via stdin as stream-json envelope
    let prompt_json = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": prompt
        }
    });
    let prompt_str = prompt_json.to_string();
    log_line(&log_handle, "STDIN", &prompt_str);
    writeln!(child_stdin, "{}", prompt_str)
        .map_err(|e| format!("Failed to write prompt to stdin: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    // Store the process entry in the map
    let mut entry = AgentProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.stdin.lock().unwrap() = Some(child_stdin);
    *entry.child.lock().unwrap() = Some(child);

    let child_arc = Arc::clone(&entry.child);
    let stdin_arc = Arc::clone(&entry.stdin);

    {
        let mut map = state.processes.lock().unwrap();
        map.insert(conversation_id.clone(), entry);
    }

    let conv_id_stdout = conversation_id.clone();
    let app_stdout = app.clone();
    let log_stdout = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            log::debug!("agent stdout [{}]: {}", conv_id_stdout, line);
            log_line(&log_stdout, "STDOUT", &line);
            let _ = app_stdout.emit(&format!("agent:stdout:{}", conv_id_stdout), line);
        }
    });

    let conv_id_stderr = conversation_id.clone();
    let app_stderr = app.clone();
    let log_stderr = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            log::warn!("agent stderr [{}]: {}", conv_id_stderr, line);
            log_line(&log_stderr, "STDERR", &line);
            let _ = app_stderr.emit(&format!("agent:stderr:{}", conv_id_stderr), line);
        }
    });

    let conv_id_exit = conversation_id.clone();
    let app_exit = app.clone();
    std::thread::spawn(move || loop {
        let mut guard = child_arc.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let _ = app_exit.emit(
                        &format!("agent:close:{}", conv_id_exit),
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

/// Write data to a Claude CLI process stdin.
#[tauri::command]
pub fn agent_stdin(
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    let entry = map
        .get(&conversation_id)
        .ok_or_else(|| format!("No process for conversation {}", conversation_id))?;
    log_line(&entry.log_file, "STDIN", &data);
    let mut guard = entry.stdin.lock().unwrap();
    if let Some(ref mut stdin) = *guard {
        writeln!(stdin, "{}", data).map_err(|e| format!("Failed to write to stdin: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        Ok(())
    } else {
        Err(format!(
            "No active stdin for conversation {}",
            conversation_id
        ))
    }
}

/// Stop a running Claude CLI process.
#[tauri::command]
pub fn stop_agent(
    state: tauri::State<AgentProcessMap>,
    conversation_id: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    if let Some(entry) = map.get(&conversation_id) {
        entry.stdin.lock().unwrap().take();
        let mut guard = entry.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            // Send SIGINT first for graceful shutdown (Unix only)
            #[cfg(unix)]
            {
                let pid = child.id();
                unsafe {
                    libc::kill(pid as i32, libc::SIGINT);
                }
                // Give the process up to 3 seconds to exit gracefully
                for _ in 0..30 {
                    std::thread::sleep(Duration::from_millis(100));
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            // Process exited gracefully
                            guard.take();
                            return Ok(());
                        }
                        Ok(None) => continue,
                        Err(_) => break,
                    }
                }
            }
            // Force kill if still running (or on non-Unix platforms)
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
    Ok(())
}

/// List all running Claude CLI conversations.
#[tauri::command]
pub fn list_running(state: tauri::State<AgentProcessMap>) -> Vec<String> {
    let map = state.processes.lock().unwrap();
    map.iter()
        .filter(|(_, entry)| entry.child.lock().unwrap().is_some())
        .map(|(id, _)| id.clone())
        .collect()
}
