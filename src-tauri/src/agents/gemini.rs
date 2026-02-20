//! Gemini CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's GeminiAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::GeminiStartConfig;
use std::sync::Arc;

/// Start a `gemini` process for a given server_id.
#[tauri::command]
pub fn start_gemini_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    gemini_path: String,
    prompt: String,
    working_dir: String,
    session_id: Option<String>,
    model_version: Option<String>,
    approval_mode: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    let config = GeminiStartConfig {
        server_id,
        gemini_path,
        prompt,
        working_dir,
        session_id,
        model_version,
        approval_mode,
        log_dir,
        log_id,
        agent_shell,
    };

    context_state.0.gemini_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Placeholder for stdin - Gemini headless mode doesn't use stdin.
#[tauri::command]
pub fn gemini_stdin(
    _context_state: tauri::State<OverseerContextState>,
    _server_id: String,
    _data: String,
) -> Result<(), String> {
    // No-op: Gemini headless mode doesn't accept stdin input
    Ok(())
}

/// Stop a running gemini process.
#[tauri::command]
pub fn stop_gemini_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.gemini_agents.stop(&server_id);
    Ok(())
}
