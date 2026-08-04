//! Sending a message (async) and reading messages with a poll cursor.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};

use overseer_core::agents::event::AgentEvent;
use overseer_core::managers::ClaudeStartConfig;

use super::attachments::{attachments_meta, build_agent_prompt, AttachmentInput};
use super::views::{fold_events, ApiMessage, View};
use super::{resolve_session, ApiEnvelope, ApiError};
use crate::HttpSharedState;

#[derive(Deserialize, Default)]
#[serde(default)]
pub(crate) struct SendMessageBody {
    text: Option<String>,
    /// Files to attach; their paths are prepended to the prompt so the agent can
    /// read them. Upload first via POST .../attachments to get a path.
    attachments: Vec<AttachmentInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendMessageResponse {
    accepted: bool,
    /// Sequence number of the persisted user message. Poll for the reply with
    /// `?sinceSeq=<lastSeq>`.
    last_seq: u64,
}

/// POST /api/v1/sessions/{sessionId}/messages
///
/// Persists the user message, then spawns (or continues) Claude. Returns
/// immediately — the reply arrives over the event stream; read it by polling
/// `GET .../messages?sinceSeq=<lastSeq>` until `turnComplete` is true.
pub(crate) async fn send_message(
    State(state): State<Arc<HttpSharedState>>,
    Path(session_id): Path<String>,
    Json(body): Json<SendMessageBody>,
) -> Result<Json<ApiEnvelope<SendMessageResponse>>, ApiError> {
    let text = body
        .text
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("Missing required field: text"))?;

    let resolved = resolve_session(&state, &session_id)?;
    let location = &resolved.location;

    // Load metadata for Claude session resume, model and permission mode.
    let metadata = state
        .context
        .chat_sessions
        .load_metadata(
            &location.project_name,
            &location.workspace_name,
            &session_id,
        )
        .map_err(ApiError::internal)?;

    // Ensure the session is registered in memory (idempotent). Needed so event
    // appends land in the right file — important after a server restart, when the
    // in-memory session map is empty.
    state
        .context
        .chat_sessions
        .register_session(
            session_id.clone(),
            location.project_name.clone(),
            location.workspace_name.clone(),
            metadata.clone(),
        )
        .map_err(ApiError::internal)?;

    // Persist the user message (the one shown in the UI). Mirrors
    // ChatSessionManager::add_user_message but returns the seq so the driver gets
    // a poll cursor. Attachments are stored in meta for the UI; the displayed
    // content stays the raw text. send_message separately persists a hidden
    // "system" echo.
    let user_event = AgentEvent::UserMessage {
        id: uuid::Uuid::new_v4().to_string(),
        content: text.clone(),
        timestamp: chrono::Utc::now(),
        meta: attachments_meta(&body.attachments),
    };
    let user_seq = state
        .context
        .chat_sessions
        .append_event_with_seq(&session_id, user_event)
        .map_err(ApiError::internal)?;

    // Resolve the Claude binary/shell from config.json (same as /api/invoke).
    let (config_agent_path, config_agent_shell) = crate::routes::load_agent_config(&state);
    let agent_path = config_agent_path.unwrap_or_else(|| "claude".to_string());

    // The agent receives the attachment paths prepended so it can read the files;
    // the persisted user message above keeps the raw text.
    let agent_prompt = build_agent_prompt(&text, &body.attachments);

    let config = ClaudeStartConfig {
        conversation_id: session_id.clone(),
        project_name: location.project_name.clone(),
        prompt: agent_prompt,
        working_dir: location.working_dir.clone(),
        agent_path,
        session_id: metadata.agent_session_id,
        model_version: metadata.model_version,
        log_dir: None,
        log_id: None,
        permission_mode: metadata.permission_mode,
        agent_shell: config_agent_shell,
        effort_level: None,
        // The driving API does not sandbox agents (yet), same as /api/invoke.
        sandboxed: false,
        git_common_dir: None,
        extra_env: Vec::new(),
        // The driving API doesn't carry a per-project Claude config dir (yet).
        claude_config_dir: None,
    };

    // Events flow through the EventBus and are persisted to the JSONL file.
    state
        .context
        .claude_agents
        .send_message(
            config,
            Arc::clone(&state.context.event_bus),
            Arc::clone(&state.context.approval_manager),
            Arc::clone(&state.context.chat_sessions),
        )
        .map_err(ApiError::internal)?;

    Ok(ApiEnvelope::ok(SendMessageResponse {
        accepted: true,
        last_seq: user_seq,
    }))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ReadQuery {
    view: Option<String>,
    since_seq: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadResponse {
    messages: Vec<ApiMessage>,
    /// Highest sequence number returned — pass back as `sinceSeq` next poll.
    last_seq: u64,
    /// True while the coding agent's process is running.
    running: bool,
    /// True once the agent finished the turn (a turn-complete marker was seen).
    turn_complete: bool,
}

/// GET /api/v1/sessions/{sessionId}/messages?view=text|full&sinceSeq=N
pub(crate) async fn read_messages(
    State(state): State<Arc<HttpSharedState>>,
    Path(session_id): Path<String>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<ApiEnvelope<ReadResponse>>, ApiError> {
    let view = View::from_query(query.view.as_deref()).map_err(ApiError::bad_request)?;
    let resolved = resolve_session(&state, &session_id)?;
    let location = &resolved.location;

    let events = match query.since_seq {
        Some(since) => state.context.chat_sessions.load_events_since_seq(
            &location.project_name,
            &location.workspace_name,
            &session_id,
            since,
        ),
        None => state.context.chat_sessions.load_events_with_seq(
            &location.project_name,
            &location.workspace_name,
            &session_id,
        ),
    }
    .map_err(ApiError::internal)?;

    let fold = fold_events(&events, view);
    // Never rewind the cursor below what the caller already had.
    let last_seq = fold.last_seq.max(query.since_seq.unwrap_or(0));
    let running = state.context.claude_agents.is_running(&session_id);

    Ok(ApiEnvelope::ok(ReadResponse {
        messages: fold.messages,
        last_seq,
        running,
        turn_complete: fold.turn_complete,
    }))
}
