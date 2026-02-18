//! Copilot CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's CopilotAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::CopilotStartConfig;
use std::sync::Arc;

/// Start a `copilot --acp --stdio` process for a given server_id.
#[tauri::command]
pub fn start_copilot_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    project_name: String,
    copilot_path: String,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    let config = CopilotStartConfig {
        server_id,
        project_name,
        copilot_path,
        model_version,
        log_dir,
        log_id,
        agent_shell,
    };

    context_state.0.copilot_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Write a line to the copilot stdin.
#[tauri::command]
pub fn copilot_stdin(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    context_state.0.copilot_agents.write_stdin(&server_id, &data)
}

/// Stop a running copilot server.
#[tauri::command]
pub fn stop_copilot_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.copilot_agents.stop(&server_id);
    Ok(())
}
