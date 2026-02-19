//! Chat session Tauri commands.
//!
//! Thin wrapper around overseer-core's ChatSessionManager.
//! The business logic lives in overseer-core; this module just exposes Tauri commands.

use std::sync::Arc;
use tauri::State;

use overseer_core::agents::event::AgentEvent;
use overseer_core::persistence::types::ChatMetadata;

// Re-export for backwards compatibility
pub use overseer_core::managers::ChatSessionManager;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Register a chat session for persistence.
#[tauri::command]
pub async fn register_chat_session(
    state: State<'_, Arc<ChatSessionManager>>,
    chat_id: String,
    project_name: String,
    workspace_name: String,
    metadata: ChatMetadata,
) -> Result<(), String> {
    state.register_session(chat_id, project_name, workspace_name, metadata)
}

/// Unregister and flush a chat session.
#[tauri::command]
pub async fn unregister_chat_session(
    state: State<'_, Arc<ChatSessionManager>>,
    chat_id: String,
) -> Result<(), String> {
    state.unregister_session(&chat_id)
}

/// Append an event to a chat session.
#[tauri::command]
pub async fn append_chat_event(
    state: State<'_, Arc<ChatSessionManager>>,
    chat_id: String,
    event: AgentEvent,
) -> Result<(), String> {
    state.append_event(&chat_id, event)
}

/// Load all events from a chat session.
#[tauri::command]
pub async fn load_chat_events(
    state: State<'_, Arc<ChatSessionManager>>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<Vec<AgentEvent>, String> {
    state.load_events(&project_name, &workspace_name, &chat_id)
}

/// Load events from a chat session starting at a given offset.
///
/// This is used for WebSocket reconnection - the client tracks how many events
/// it has processed, and on reconnect fetches only the events after that offset.
#[tauri::command]
pub async fn load_chat_events_since(
    state: State<'_, Arc<ChatSessionManager>>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
    offset: usize,
) -> Result<Vec<AgentEvent>, String> {
    let events = state.load_events(&project_name, &workspace_name, &chat_id)?;
    Ok(events.into_iter().skip(offset).collect())
}

/// Load chat metadata for a session.
#[tauri::command]
pub async fn load_chat_metadata(
    state: State<'_, Arc<ChatSessionManager>>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<ChatMetadata, String> {
    state.load_metadata(&project_name, &workspace_name, &chat_id)
}

/// Save chat metadata for a session.
#[tauri::command]
pub async fn save_chat_metadata(
    state: State<'_, Arc<ChatSessionManager>>,
    project_name: String,
    workspace_name: String,
    metadata: ChatMetadata,
) -> Result<(), String> {
    state.save_metadata(&project_name, &workspace_name, metadata)
}

/// Persist a user-authored message for a chat session.
#[tauri::command]
pub async fn add_user_message(
    state: State<'_, Arc<ChatSessionManager>>,
    chat_id: String,
    content: String,
    meta: Option<serde_json::Value>,
) -> Result<AgentEvent, String> {
    state.add_user_message(&chat_id, content, meta)
}
