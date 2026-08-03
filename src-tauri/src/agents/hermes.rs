//! Hermes CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's HermesAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::HermesStartConfig;
use std::sync::Arc;

/// Start a `hermes acp` process for a given server_id.
#[tauri::command]
pub async fn start_hermes_server(
    context_state: tauri::State<'_, OverseerContextState>,
    server_id: String,
    project_name: String,
    hermes_path: String,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    let config = HermesStartConfig {
        server_id,
        project_name,
        hermes_path,
        log_dir,
        log_id,
        agent_shell,
    };

    context_state.0.hermes_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Write a line to the hermes stdin.
#[tauri::command]
pub async fn hermes_stdin(
    context_state: tauri::State<'_, OverseerContextState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    context_state.0.hermes_agents.write_stdin(&server_id, &data)
}

/// Toggle replay suppression around a `session/load` call.
///
/// The frontend enables this before sending `session/load` (so the replayed
/// transcript is not re-emitted or re-persisted) and disables it after the
/// load response resolves.
#[tauri::command]
pub async fn hermes_set_replay_suppression(
    context_state: tauri::State<'_, OverseerContextState>,
    server_id: String,
    suppress: bool,
) -> Result<(), String> {
    context_state
        .0
        .hermes_agents
        .set_replay_suppression(&server_id, suppress)
}

/// Stop a running hermes server.
#[tauri::command]
pub async fn stop_hermes_server(
    context_state: tauri::State<'_, OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.hermes_agents.stop(&server_id);
    Ok(())
}
