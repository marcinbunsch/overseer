//! Gemini CLI process management.
//!
//! Handles spawning and communication with the Gemini CLI using the headless
//! NDJSON streaming protocol. Unlike Claude/Codex, Gemini uses a one-shot
//! process model where each message spawns a new process.

use std::{
    collections::HashMap,
    io::BufRead,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

use super::shared::{prepare_path_env, AgentExit};
use crate::logging::{log_line, open_log_file, LogHandle};

struct GeminiProcessEntry {
    child: Arc<Mutex<Option<Child>>>,
    log_file: LogHandle,
}

impl Default for GeminiProcessEntry {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Default)]
pub struct GeminiServerMap {
    processes: Mutex<HashMap<String, GeminiProcessEntry>>,
}

/// Start a `gemini` process for a given server_id (typically chat id).
///
/// Gemini CLI uses a one-shot model: each message spawns a new process with
/// `--output-format stream-json`. The process streams NDJSON events on stdout
/// and exits when done. Session continuity is handled via `--resume` flag.
#[tauri::command]
pub fn start_gemini_server(
    app: tauri::AppHandle,
    state: tauri::State<GeminiServerMap>,
    server_id: String,
    gemini_path: String,
    prompt: String,
    working_dir: String,
    session_id: Option<String>,
    model_version: Option<String>,
    approval_mode: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
) -> Result<(), String> {
    // Stop any existing process for this id first.
    {
        let map = state.processes.lock().unwrap();
        if let Some(entry) = map.get(&server_id) {
            if let Some(mut child) = entry.child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    }

    // Build command arguments
    let mut args: Vec<String> = vec![
        "-p".to_string(),
        prompt,
        "--output-format".to_string(),
        "stream-json".to_string(),
    ];

    // Add approval mode (defaults to yolo if not specified)
    let mode = approval_mode.unwrap_or_else(|| "yolo".to_string());
    args.push("--approval-mode".to_string());
    args.push(mode);

    // Add model if specified
    if let Some(ref model) = model_version {
        if !model.is_empty() {
            args.push("-m".to_string());
            args.push(model.clone());
        }
    }

    // Add resume if we have a session
    if let Some(ref sid) = session_id {
        if !sid.is_empty() {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }
    }

    let mut cmd = Command::new(&gemini_path);
    cmd.args(&args)
        .current_dir(&working_dir)
        .stdin(Stdio::null()) // No stdin communication for Gemini headless
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    prepare_path_env(&mut cmd, &gemini_path);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn gemini: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture gemini stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture gemini stderr".to_string())?;

    // Open log file if log_dir provided
    let lid = log_id.as_deref().unwrap_or(&server_id);
    let log_handle = open_log_file(&log_dir, lid);

    let mut entry = GeminiProcessEntry::default();
    entry.log_file = Arc::clone(&log_handle);
    *entry.child.lock().unwrap() = Some(child);

    let child_arc = Arc::clone(&entry.child);

    {
        let mut map = state.processes.lock().unwrap();
        map.insert(server_id.clone(), entry);
    }

    // stdout reader — emit each line as a Tauri event
    let sid_stdout = server_id.clone();
    let app_stdout = app.clone();
    let log_stdout = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().flatten() {
            log::debug!("gemini stdout [{}]: {}", sid_stdout, line);
            log_line(&log_stdout, "STDOUT", &line);
            let _ = app_stdout.emit(&format!("gemini:stdout:{}", sid_stdout), line);
        }
    });

    // stderr reader — log and emit
    let sid_stderr = server_id.clone();
    let app_stderr = app.clone();
    let log_stderr = Arc::clone(&log_handle);
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().flatten() {
            log::warn!("gemini stderr [{}]: {}", sid_stderr, line);
            log_line(&log_stderr, "STDERR", &line);
            let _ = app_stderr.emit(&format!("gemini:stderr:{}", sid_stderr), line);
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
                        &format!("gemini:close:{}", sid_exit),
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

    Ok(())
}

/// Placeholder for stdin - Gemini headless mode doesn't use stdin for communication.
/// Kept for interface consistency with other agents.
#[tauri::command]
pub fn gemini_stdin(
    _state: tauri::State<GeminiServerMap>,
    _server_id: String,
    _data: String,
) -> Result<(), String> {
    // No-op: Gemini headless mode doesn't accept stdin input
    Ok(())
}

/// Stop a running gemini process.
#[tauri::command]
pub fn stop_gemini_server(
    state: tauri::State<GeminiServerMap>,
    server_id: String,
) -> Result<(), String> {
    let map = state.processes.lock().unwrap();
    if let Some(entry) = map.get(&server_id) {
        if let Some(mut child) = entry.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    Ok(())
}
