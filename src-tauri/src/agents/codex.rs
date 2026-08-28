//! Codex CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's CodexAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::CodexStartConfig;
use std::sync::Arc;

/// Start a `codex app-server` process for a given server_id.
#[tauri::command]
pub async fn start_codex_server(
    context_state: tauri::State<'_, OverseerContextState>,
    agent_api_state: tauri::State<'_, crate::agent_api::AgentApiState>,
    server_id: String,
    project_name: String,
    codex_path: String,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    agent_shell: Option<String>,
    working_dir: String,
    sandboxed: Option<bool>,
) -> Result<(), String> {
    // When sandboxed, resolve the shared git directory now (async) so the
    // manager's sync spawn path can grant it write access. A worktree's git
    // state lives in the main repo's `.git`, not the workspace.
    let sandboxed = sandboxed.unwrap_or(false);
    let git_common_dir = if sandboxed {
        let resolved = overseer_core::git::get_git_common_dir(std::path::Path::new(&working_dir))
            .await
            .map_err(|e| format!("Failed to resolve git directory for sandbox: {e}"))?;
        Some(resolved.to_string_lossy().to_string())
    } else {
        None
    };

    // For a sandboxed agent, hand it the address + a scoped token for Overseer's
    // internal git API so it can push / open PRs despite the scrubbed environment.
    let extra_env = crate::agents::claude::build_agent_api_env(
        &agent_api_state,
        sandboxed,
        &server_id,
        &working_dir,
        &agent_shell,
    )
    .await;

    let config = CodexStartConfig {
        server_id,
        project_name,
        codex_path,
        model_version,
        log_dir,
        log_id,
        agent_shell,
        working_dir,
        sandboxed,
        git_common_dir,
        extra_env,
    };

    context_state.0.codex_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Write a line to the codex app-server stdin.
#[tauri::command]
pub fn codex_stdin(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
    data: String,
) -> Result<(), String> {
    context_state.0.codex_agents.write_stdin(&server_id, &data)
}

/// Stop a running codex app-server.
#[tauri::command]
pub fn stop_codex_server(
    context_state: tauri::State<OverseerContextState>,
    server_id: String,
) -> Result<(), String> {
    context_state.0.codex_agents.stop(&server_id);
    Ok(())
}
