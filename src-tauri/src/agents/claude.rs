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
pub async fn send_message(
    context_state: tauri::State<'_, OverseerContextState>,
    persistence_config: tauri::State<'_, PersistenceConfig>,
    agent_api_state: tauri::State<'_, crate::agent_api::AgentApiState>,
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
    effort_level: Option<String>,
    sandboxed: Option<bool>,
    claude_config_dir: Option<String>,
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
    // internal git API, so it can push / open PRs on the host despite the scrubbed
    // environment. The token maps only to this session's workspace + branch and is
    // revoked when the process closes (see the agent:close handler in lib.rs).
    let extra_env = build_agent_api_env(
        &agent_api_state,
        sandboxed,
        &conversation_id,
        &working_dir,
        &resolved_agent_shell,
    )
    .await;

    // A per-project Claude config directory (CLAUDE_CONFIG_DIR) points Claude at a
    // different login, which is how a project uses a separate account. Passed raw;
    // the manager expands ~/$HOME and sets the env var on both spawn paths.
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
        effort_level,
        sandboxed,
        git_common_dir,
        extra_env,
        claude_config_dir,
    };

    context_state.0.claude_agents.send_message(
        config,
        Arc::clone(&context_state.0.event_bus),
        Arc::clone(&context_state.0.approval_manager),
        Arc::clone(&context_state.0.chat_sessions),
    )
}

/// Build the environment variables that point a sandboxed agent at Overseer's
/// internal git API, registering a session-scoped token in the process.
///
/// Returns an empty vec when the agent isn't sandboxed (it has host credentials
/// already) or when the service hasn't started — the agent simply won't see the
/// API in its environment and falls back to normal git/gh.
async fn build_agent_api_env(
    agent_api_state: &crate::agent_api::AgentApiState,
    sandboxed: bool,
    conversation_id: &str,
    working_dir: &str,
    agent_shell: &Option<String>,
) -> Vec<(String, String)> {
    if !sandboxed {
        return Vec::new();
    }

    let Some(base_url) = agent_api_state.base_url() else {
        log::warn!("agent-api service not started; sandboxed agent won't get git API access");
        return Vec::new();
    };

    // The branch the agent will push / open a PR for. Fall back to HEAD, which
    // still works for `git push` even if the symbolic name can't be read.
    let branch = overseer_core::git::get_current_branch(std::path::Path::new(working_dir))
        .await
        .unwrap_or_else(|_| "HEAD".to_string());

    // Reuse the conversation's existing token if it has one — the running process
    // keeps the token it was spawned with, so minting a new one here would revoke
    // the one it still holds. `ensure_token` only mints when none exists yet.
    let token = agent_api_state.registry.ensure_token(
        uuid::Uuid::new_v4().to_string(),
        crate::agent_api::SessionScope {
            conversation_id: conversation_id.to_string(),
            workspace_path: working_dir.to_string(),
            branch,
            agent_shell: agent_shell.clone(),
        },
    );

    vec![
        ("OVERSEER_API_URL".to_string(), base_url),
        ("OVERSEER_API_TOKEN".to_string(), token),
    ]
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
