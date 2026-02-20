//! OpenCode Tauri commands.
//!
//! Thin wrapper around overseer-core's OpenCodeAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::{
    opencode_list_models_cli, OpenCodeModel, OpenCodeStartConfig,
};
use std::sync::Arc;

/// Start an `opencode serve` process for a given server_id.
#[tauri::command]
pub fn start_opencode_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    opencode_path: String,
    port: u16,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
) -> Result<String, String> {
    let config = OpenCodeStartConfig {
        server_id,
        opencode_path,
        port,
        log_dir,
        log_id,
        agent_shell,
    };

    let info = context_state.0.opencode_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
    )?;

    // Return JSON with port and password
    Ok(format!(
        r#"{{"port":{}, "password":"{}"}}"#,
        info.port, info.password
    ))
}

/// Get the port for a running opencode server.
#[tauri::command]
pub fn get_opencode_port(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<u16, String> {
    context_state.0.opencode_agents.get_port(&server_id)
}

/// Get the password for a running opencode server.
#[tauri::command]
pub fn get_opencode_password(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<String, String> {
    context_state.0.opencode_agents.get_password(&server_id)
}

/// Stop a running opencode serve process.
#[tauri::command]
pub fn stop_opencode_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.opencode_agents.stop(&server_id);
    Ok(())
}

/// Fetch available models from the OpenCode server.
#[tauri::command(async)]
pub fn opencode_get_models(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<Vec<OpenCodeModel>, String> {
    context_state.0.opencode_agents.get_models(&server_id)
}

/// Subscribe to SSE events from the OpenCode server.
#[tauri::command]
pub fn opencode_subscribe_events(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    session_id: String,
) -> Result<(), String> {
    context_state.0.opencode_agents.subscribe_events(
        &server_id,
        session_id,
        Arc::clone(&context_state.0.event_bus),
    )
}

/// Stop SSE subscription for an OpenCode server.
#[tauri::command]
pub fn opencode_unsubscribe_events(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.opencode_agents.unsubscribe_events(&server_id);
    Ok(())
}

/// Fetch available models by running `opencode models` CLI command.
#[tauri::command(async)]
pub fn opencode_list_models(
    opencode_path: String,
    agent_shell: Option<String>,
) -> Result<Vec<OpenCodeModel>, String> {
    opencode_list_models_cli(&opencode_path, agent_shell.as_deref())
}
