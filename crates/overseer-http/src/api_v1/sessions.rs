//! Session creation and status.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};

use overseer_core::persistence::{
    load_chat_index, save_chat_index, upsert_chat_entry, ChatIndexEntry, ChatMetadata,
};

use super::{resolve_session, resolve_workspace, ApiEnvelope, ApiError};
use crate::HttpSharedState;

/// Permission mode for API-created sessions when the caller doesn't pick one.
/// The driver is a machine, so nothing should pause for a human to approve.
const DEFAULT_PERMISSION_MODE: &str = "bypassPermissions";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CreateSessionBody {
    label: Option<String>,
    model_version: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSessionResponse {
    session_id: String,
}

/// POST /api/v1/workspaces/{workspaceId}/sessions
pub(crate) async fn create_session(
    State(state): State<Arc<HttpSharedState>>,
    Path(workspace_id): Path<String>,
    Json(body): Json<CreateSessionBody>,
) -> Result<Json<ApiEnvelope<CreateSessionResponse>>, ApiError> {
    let location = resolve_workspace(&state, &workspace_id)?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let label = body
        .label
        .filter(|l| !l.trim().is_empty())
        .unwrap_or_else(|| "API session".to_string());
    let permission_mode = body
        .permission_mode
        .unwrap_or_else(|| DEFAULT_PERMISSION_MODE.to_string());
    let now = chrono::Utc::now();

    let metadata = ChatMetadata {
        id: session_id.clone(),
        workspace_id: workspace_id.clone(),
        label: label.clone(),
        agent_type: Some("claude".to_string()),
        agent_session_id: None,
        model_version: body.model_version,
        permission_mode: Some(permission_mode),
        sandboxed: false,
        created_at: now,
        updated_at: now,
    };

    // Writes `{session_id}.meta.json` under the chat directory.
    state
        .context
        .chat_sessions
        .register_session(
            session_id.clone(),
            location.project_name.clone(),
            location.workspace_name.clone(),
            metadata,
        )
        .map_err(ApiError::internal)?;

    // Add the chat to the workspace's index so the desktop sidebar lists it.
    let chat_dir = state
        .get_chat_dir(&location.project_name, &location.workspace_name)
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;
    let mut index = load_chat_index(&chat_dir).map_err(|e| ApiError::internal(e.to_string()))?;
    upsert_chat_entry(
        &mut index,
        ChatIndexEntry {
            id: session_id.clone(),
            label,
            agent_type: Some("claude".to_string()),
            created_at: now,
            updated_at: now,
            is_archived: None,
            archived_at: None,
        },
    );
    save_chat_index(&chat_dir, &index).map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(ApiEnvelope::ok(CreateSessionResponse { session_id }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionStatus {
    session_id: String,
    workspace_id: String,
    label: String,
    agent_type: Option<String>,
    /// True while the coding agent's process is running (a turn is in flight).
    running: bool,
    /// Highest event sequence number persisted so far — the poll cursor tail.
    last_seq: u64,
}

/// GET /api/v1/sessions/{sessionId}
pub(crate) async fn get_session(
    State(state): State<Arc<HttpSharedState>>,
    Path(session_id): Path<String>,
) -> Result<Json<ApiEnvelope<SessionStatus>>, ApiError> {
    let resolved = resolve_session(&state, &session_id)?;
    let location = &resolved.location;

    let metadata = state
        .context
        .chat_sessions
        .load_metadata(
            &location.project_name,
            &location.workspace_name,
            &session_id,
        )
        .map_err(ApiError::internal)?;

    let last_seq = state
        .context
        .chat_sessions
        .load_events_with_seq(
            &location.project_name,
            &location.workspace_name,
            &session_id,
        )
        .map_err(ApiError::internal)?
        .last()
        .map(|event| event.seq)
        .unwrap_or(0);

    let running = state.context.claude_agents.is_running(&session_id);

    Ok(ApiEnvelope::ok(SessionStatus {
        session_id,
        workspace_id: resolved.workspace_id,
        label: metadata.label,
        agent_type: metadata.agent_type,
        running,
        last_seq,
    }))
}
