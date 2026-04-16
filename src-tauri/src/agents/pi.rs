//! Pi coding agent Tauri commands.
//!
//! Thin wrapper around overseer-core's PiAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::agents::pi::{list_pi_models_from_cli, PiModel};
use overseer_core::managers::PiStartConfig;
use std::sync::Arc;

/// Start a `pi --mode rpc` process for a given server_id.
#[tauri::command]
pub fn start_pi_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    pi_path: String,
    working_dir: String,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    let config = PiStartConfig {
        server_id,
        pi_path,
        working_dir,
        log_dir,
        log_id,
        agent_shell,
    };

    context_state.0.pi_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Write data to a Pi process's stdin.
///
/// Used to send RPC commands (prompt, abort, set_model, etc.)
#[tauri::command]
pub fn pi_stdin(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    context_state.0.pi_agents.write_stdin(&server_id, &data)
}

/// Stop a running Pi process.
#[tauri::command]
pub fn stop_pi_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.pi_agents.stop(&server_id);
    Ok(())
}

/// Fetch available models by running `pi --list-models`.
#[tauri::command(async)]
pub fn pi_list_models(
    pi_path: String,
    agent_shell: Option<String>,
) -> Result<Vec<PiModel>, String> {
    list_pi_models_from_cli(&pi_path, agent_shell.as_deref())
}
