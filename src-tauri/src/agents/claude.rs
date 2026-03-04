//! Claude CLI Tauri commands.
//!
//! Thin wrapper around overseer-core's ClaudeAgentManager.
//! All business logic lives in overseer-core; this module just exposes Tauri commands.

use crate::persistence::PersistenceConfig;
use crate::OverseerContextState;
use overseer_core::managers::ClaudeStartConfig;
use std::sync::Arc;

/// Write data to a Claude CLI process stdin.
#[tauri::command]
pub fn agent_stdin(
    context_state: tauri::State<OverseerContextState>,
    conversation_id: String,
    data: String,
) -> Result<(), String> {
    context_state
        .0
        .claude_agents
        .write_stdin(&conversation_id, &data)
}

/// Send a message to a Claude conversation.
///
/// This is the unified entry point - the backend decides whether to
/// start a new process or send via stdin to an existing one.
///
/// agent_path and agent_shell are optional - if not provided, they are read from config.json.
#[tauri::command]
pub fn send_message(
    context_state: tauri::State<OverseerContextState>,
    persistence_config: tauri::State<PersistenceConfig>,
    conversation_id: String,
    project_name: String,
    prompt: String,
    working_dir: String,
    agent_path: Option<String>,
    session_id: Option<String>,
    model_version: Option<String>,
    log_dir: Option<String>,
    log_id: Option<String>,
    permission_mode: Option<String>,
    agent_shell: Option<String>,
) -> Result<(), String> {
    // Get config directory for reading defaults
    let config_dir = persistence_config.get_config_dir().ok();

    // Use provided agent_path or read from config
    let resolved_agent_path = agent_path
        .or_else(|| {
            config_dir
                .as_ref()
                .and_then(|dir| crate::persistence::get_claude_path_from_config(dir))
        })
        .unwrap_or_else(|| "claude".to_string()); // Default to "claude" if nothing configured

    // Use provided agent_shell or read from config
    let resolved_agent_shell = agent_shell.or_else(|| {
        config_dir
            .as_ref()
            .and_then(|dir| crate::persistence::get_agent_shell_from_config(dir))
    });

    let config = ClaudeStartConfig {
        conversation_id,
        project_name,
        prompt,
        working_dir,
        agent_path: resolved_agent_path,
        session_id,
        model_version,
        log_dir,
        log_id,
        permission_mode,
        agent_shell: resolved_agent_shell,
    };

    context_state.0.claude_agents.send_message(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
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
