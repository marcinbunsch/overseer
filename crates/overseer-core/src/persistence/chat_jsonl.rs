//! JSONL chat event persistence.
//!
//! Stores chat events as append-only JSON lines:
//! `{chat_id}.jsonl`
//! and metadata in `{chat_id}.meta.json`.

use std::fs;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::agents::event::AgentEvent;

use super::chat::load_chat;
use super::types::{ChatFile, ChatMetadata, MessageMeta};

/// Error type for JSONL chat persistence.
#[derive(Debug)]
pub enum ChatJsonlError {
    /// IO error (file not found, permission denied, etc.)
    Io(std::io::Error),
    /// JSON serialization/deserialization error
    Json(serde_json::Error),
    /// Metadata not found
    NotFound(String),
}

impl std::fmt::Display for ChatJsonlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatJsonlError::Io(e) => write!(f, "IO error: {e}"),
            ChatJsonlError::Json(e) => write!(f, "JSON error: {e}"),
            ChatJsonlError::NotFound(id) => write!(f, "Chat metadata not found: {id}"),
        }
    }
}

impl std::error::Error for ChatJsonlError {}

impl From<std::io::Error> for ChatJsonlError {
    fn from(e: std::io::Error) -> Self {
        ChatJsonlError::Io(e)
    }
}

impl From<serde_json::Error> for ChatJsonlError {
    fn from(e: serde_json::Error) -> Self {
        ChatJsonlError::Json(e)
    }
}

/// Save chat metadata to `{chat_id}.meta.json`.
pub fn save_chat_metadata(dir: &Path, metadata: &ChatMetadata) -> Result<(), ChatJsonlError> {
    fs::create_dir_all(dir)?;

    let file_path = dir.join(format!("{}.meta.json", metadata.id));
    let temp_path = dir.join(format!("{}.meta.json.tmp", metadata.id));

    let json = serde_json::to_string_pretty(metadata)?;
    fs::write(&temp_path, json)?;
    fs::rename(&temp_path, &file_path)?;

    Ok(())
}

/// Load chat metadata from `{chat_id}.meta.json`.
pub fn load_chat_metadata(dir: &Path, chat_id: &str) -> Result<ChatMetadata, ChatJsonlError> {
    let file_path = dir.join(format!("{chat_id}.meta.json"));

    if !file_path.exists() {
        return Err(ChatJsonlError::NotFound(chat_id.to_string()));
    }

    let contents = fs::read_to_string(&file_path)?;
    let metadata: ChatMetadata = serde_json::from_str(&contents)?;

    Ok(metadata)
}

/// Serialize an event for storage, marking prompt events as processed.
pub fn serialize_event_for_storage(event: &AgentEvent) -> Result<String, ChatJsonlError> {
    let mut value = serde_json::to_value(event)?;
    if matches!(
        event,
        AgentEvent::ToolApproval { .. }
            | AgentEvent::Question { .. }
            | AgentEvent::PlanApproval { .. }
    ) {
        if let serde_json::Value::Object(map) = &mut value {
            map.insert(
                "is_processed".to_string(),
                serde_json::Value::Bool(true),
            );
        }
    }

    Ok(serde_json::to_string(&value)?)
}

/// Append a single event to `{chat_id}.jsonl`.
pub fn append_chat_event(
    dir: &Path,
    chat_id: &str,
    event: &AgentEvent,
) -> Result<(), ChatJsonlError> {
    fs::create_dir_all(dir)?;

    let file_path = dir.join(format!("{chat_id}.jsonl"));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)?;

    let line = serialize_event_for_storage(event)?;
    writeln!(file, "{line}")?;

    Ok(())
}

/// Load all events from `{chat_id}.jsonl`.
///
/// Returns an empty list if the file doesn't exist.
pub fn load_chat_events(dir: &Path, chat_id: &str) -> Result<Vec<AgentEvent>, ChatJsonlError> {
    let file_path = dir.join(format!("{chat_id}.jsonl"));

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let file = fs::File::open(file_path)?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let event: AgentEvent = serde_json::from_str(&line)?;
        events.push(event);
    }

    Ok(events)
}

/// Migrate a legacy `{chat_id}.json` chat file to JSONL + metadata if needed.
///
/// Returns `Ok(true)` if migration occurred, `Ok(false)` if no migration was needed.
pub fn migrate_chat_if_needed(dir: &Path, chat_id: &str) -> Result<bool, ChatJsonlError> {
    let jsonl_path = dir.join(format!("{chat_id}.jsonl"));
    if jsonl_path.exists() {
        return Ok(false);
    }

    let legacy_path = dir.join(format!("{chat_id}.json"));
    if !legacy_path.exists() {
        return Ok(false);
    }

    let chat = load_chat(dir, chat_id).map_err(|err| match err {
        super::chat::ChatError::Io(e) => ChatJsonlError::Io(e),
        super::chat::ChatError::Json(e) => ChatJsonlError::Json(e),
        super::chat::ChatError::NotFound(id) => ChatJsonlError::NotFound(id),
    })?;

    write_metadata_from_chat(dir, &chat)?;
    write_events_from_chat(dir, &chat)?;

    Ok(true)
}

fn write_metadata_from_chat(dir: &Path, chat: &ChatFile) -> Result<(), ChatJsonlError> {
    let metadata = ChatMetadata {
        id: chat.id.clone(),
        workspace_id: chat.workspace_id.clone(),
        label: chat.label.clone(),
        agent_type: chat.agent_type.clone(),
        agent_session_id: chat.agent_session_id.clone(),
        model_version: chat.model_version.clone(),
        permission_mode: chat.permission_mode.clone(),
        created_at: chat.created_at,
        updated_at: chat.updated_at,
    };

    save_chat_metadata(dir, &metadata)
}

fn write_events_from_chat(dir: &Path, chat: &ChatFile) -> Result<(), ChatJsonlError> {
    fs::create_dir_all(dir)?;

    let file_path = dir.join(format!("{}.jsonl", chat.id));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(file_path)?;

    for message in &chat.messages {
        if message.content.trim().is_empty() {
            continue;
        }

        let event = match message.role.as_str() {
            "user" => AgentEvent::UserMessage {
                id: message.id.clone(),
                content: message.content.clone(),
                timestamp: message.timestamp,
                meta: message
                    .meta
                    .as_ref()
                    .and_then(serialize_message_meta_for_event),
            },
            "assistant" => {
                if message.is_bash_output.unwrap_or(false) {
                    if message.tool_meta.is_some() || message.is_info.unwrap_or(false) {
                        continue;
                    }
                    AgentEvent::BashOutput {
                        text: message.content.clone(),
                    }
                } else {
                    AgentEvent::Message {
                        content: message.content.clone(),
                        tool_meta: message.tool_meta.clone(),
                        parent_tool_use_id: message.parent_tool_use_id.clone(),
                        tool_use_id: message.tool_use_id.clone(),
                        is_info: message.is_info,
                    }
                }
            }
            _ => continue,
        };

        let line = serialize_event_for_storage(&event)?;
        writeln!(file, "{line}")?;
    }

    Ok(())
}

fn serialize_message_meta_for_event(meta: &MessageMeta) -> Option<serde_json::Value> {
    serde_json::to_value(meta).ok()
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::chat::save_chat;
    use crate::persistence::types::{ChatFile, Message, MessageMeta};
    use chrono::Utc;
    use serde_json::json;
    use tempfile::tempdir;

    fn make_metadata(id: &str) -> ChatMetadata {
        ChatMetadata {
            id: id.to_string(),
            workspace_id: "ws-1".to_string(),
            label: "Test Chat".to_string(),
            agent_type: Some("claude".to_string()),
            agent_session_id: Some("session-1".to_string()),
            model_version: Some("model-1".to_string()),
            permission_mode: Some("ask".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn save_and_load_metadata() {
        let dir = tempdir().unwrap();
        let metadata = make_metadata("chat-1");

        save_chat_metadata(dir.path(), &metadata).unwrap();
        let loaded = load_chat_metadata(dir.path(), "chat-1").unwrap();

        assert_eq!(loaded.id, "chat-1");
        assert_eq!(loaded.label, "Test Chat");
        assert_eq!(loaded.agent_session_id, Some("session-1".to_string()));
    }

    #[test]
    fn append_and_load_events_marks_processed() {
        let dir = tempdir().unwrap();
        let event = AgentEvent::ToolApproval {
            request_id: "req-1".to_string(),
            name: "Bash".to_string(),
            input: json!({ "command": "ls" }),
            display_input: "ls".to_string(),
            prefixes: Some(vec!["ls".to_string()]),
            auto_approved: false,
            is_processed: None,
        };

        append_chat_event(dir.path(), "chat-1", &event).unwrap();
        let events = load_chat_events(dir.path(), "chat-1").unwrap();

        assert_eq!(events.len(), 1);
        match &events[0] {
            AgentEvent::ToolApproval { is_processed, .. } => {
                assert_eq!(*is_processed, Some(true));
            }
            _ => panic!("Expected ToolApproval event"),
        }
    }

    #[test]
    fn load_chat_events_missing_returns_empty() {
        let dir = tempdir().unwrap();
        let events = load_chat_events(dir.path(), "missing-chat").unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn migrate_chat_if_needed_skips_when_missing() {
        let dir = tempdir().unwrap();
        let migrated = migrate_chat_if_needed(dir.path(), "missing-chat").unwrap();
        assert!(!migrated);
    }

    #[test]
    fn migrate_chat_if_needed_creates_jsonl_and_metadata() {
        let dir = tempdir().unwrap();
        let now = Utc::now();
        let chat = ChatFile {
            id: "chat-1".to_string(),
            workspace_id: "ws-1".to_string(),
            label: "Legacy Chat".to_string(),
            messages: vec![
                Message {
                    id: "msg-1".to_string(),
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                    timestamp: now,
                    tool_meta: None,
                    meta: Some(MessageMeta {
                        message_type: Some("note".to_string()),
                        extra: json!({"source":"legacy"}),
                    }),
                    is_bash_output: None,
                    is_info: None,
                    parent_tool_use_id: None,
                    tool_use_id: None,
                },
                Message {
                    id: "msg-2".to_string(),
                    role: "assistant".to_string(),
                    content: "ls output".to_string(),
                    timestamp: now,
                    tool_meta: None,
                    meta: None,
                    is_bash_output: Some(true),
                    is_info: None,
                    parent_tool_use_id: None,
                    tool_use_id: None,
                },
            ],
            agent_type: Some("claude".to_string()),
            agent_session_id: None,
            model_version: None,
            permission_mode: None,
            created_at: now,
            updated_at: now,
        };

        save_chat(dir.path(), &chat).unwrap();
        let migrated = migrate_chat_if_needed(dir.path(), "chat-1").unwrap();
        assert!(migrated);

        let metadata = load_chat_metadata(dir.path(), "chat-1").unwrap();
        assert_eq!(metadata.label, "Legacy Chat");

        let events = load_chat_events(dir.path(), "chat-1").unwrap();
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], AgentEvent::UserMessage { .. }));
        assert!(matches!(events[1], AgentEvent::BashOutput { .. }));
    }
}
