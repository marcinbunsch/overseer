//! Claude CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's ClaudeAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::OverseerContextState;
use overseer_core::managers::ClaudeStartConfig;
use std::sync::Arc;

/// Start a Claude CLI process for a conversation.
#[tauri::command]
pub fn start_agent(
    context_state: tauri::State<OverseerContextState>,
    conversation_id: String,
    project_name: String,
    prompt: String,
    working_dir: String,
    agent_path: String,
    session_id: Option<String>,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    permission_mode: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    let config = ClaudeStartConfig {
        conversation_id,
        project_name,
        prompt,
        working_dir,
        agent_path,
        session_id,
        model_version,
        log_dir,
        log_id,
        permission_mode,
        agent_shell,
    };

    context_state.0.claude_agents.start(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Write data to a Claude CLI process stdin.
#[tauri::command]
pub fn agent_stdin(
    context_state: tauri::State<OverseerContextState>,
    conversation_id: String,
    data: String,
) -> Result<(), String> {
    context_state.0.claude_agents.write_stdin(&conversation_id, &data)
}

/// Stop a running Claude CLI process.
#[tauri::command]
pub fn stop_agent(
    context_state: tauri::State<OverseerContextState>,
    conversation_id: String,
) -> Result<(), String> {
    context_state.0.claude_agents.stop(&conversation_id);
    Ok(())
}

/// List all running Claude CLI conversations.
#[tauri::command]
pub fn list_running(context_state: tauri::State<OverseerContextState>) -> Vec<String> {
    context_state.0.claude_agents.list_running()
}
