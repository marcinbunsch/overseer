//! Chat index and workspace state persistence.
//!
//! # Files
//!
//! - `chats.json` - Chat index (metadata for all chats in workspace)
//! - `workspace.json` - Workspace state (active chat ID)
//!
//! # Design
//!
//! The chat index provides lightweight metadata for the sidebar,
//! while full chat messages are loaded lazily from individual files.

use std::fs;
use std::path::Path;

use super::types::{ChatIndex, ChatIndexEntry, WorkspaceState};

/// Error type for index operations.
#[derive(Debug)]
pub enum IndexError {
    /// IO error
    Io(std::io::Error),
    /// JSON error
    Json(serde_json::Error),
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexError::Io(e) => write!(f, "IO error: {e}"),
            IndexError::Json(e) => write!(f, "JSON error: {e}"),
        }
    }
}

impl std::error::Error for IndexError {}

impl From<std::io::Error> for IndexError {
    fn from(e: std::io::Error) -> Self {
        IndexError::Io(e)
    }
}

impl From<serde_json::Error> for IndexError {
    fn from(e: serde_json::Error) -> Self {
        IndexError::Json(e)
    }
}

// ============================================================================
// Chat Index Operations
// ============================================================================

/// Save the chat index to disk.
///
/// Writes to `chats.json` in the workspace directory.
pub fn save_chat_index(dir: &Path, index: &ChatIndex) -> Result<(), IndexError> {
    fs::create_dir_all(dir)?;

    let file_path = dir.join("chats.json");
    let temp_path = dir.join("chats.json.tmp");

    let json = serde_json::to_string_pretty(index)?;
    fs::write(&temp_path, json)?;
    fs::rename(&temp_path, &file_path)?;

    Ok(())
}

/// Load the chat index from disk.
///
/// Returns an empty index if the file doesn't exist.
pub fn load_chat_index(dir: &Path) -> Result<ChatIndex, IndexError> {
    let file_path = dir.join("chats.json");

    if !file_path.exists() {
        return Ok(ChatIndex::default());
    }

    let contents = fs::read_to_string(&file_path)?;
    let index: ChatIndex = serde_json::from_str(&contents)?;

    Ok(index)
}

/// Add or update a chat entry in the index.
///
/// If an entry with the same ID exists, it's replaced.
pub fn upsert_chat_entry(index: &mut ChatIndex, entry: ChatIndexEntry) {
    // Remove existing entry with same ID
    index.chats.retain(|c| c.id != entry.id);
    // Add new entry
    index.chats.push(entry);
}

/// Remove a chat entry from the index.
pub fn remove_chat_entry(index: &mut ChatIndex, chat_id: &str) {
    index.chats.retain(|c| c.id != chat_id);
}

/// Find a chat entry by ID.
pub fn find_chat_entry<'a>(index: &'a ChatIndex, chat_id: &str) -> Option<&'a ChatIndexEntry> {
    index.chats.iter().find(|c| c.id == chat_id)
}

/// Get non-archived chats sorted by updated_at (most recent first).
pub fn get_active_chats(index: &ChatIndex) -> Vec<&ChatIndexEntry> {
    let mut chats: Vec<_> = index
        .chats
        .iter()
        .filter(|c| c.is_archived != Some(true))
        .collect();

    chats.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    chats
}

/// Get archived chats sorted by archived_at (most recent first).
pub fn get_archived_chats(index: &ChatIndex) -> Vec<&ChatIndexEntry> {
    let mut chats: Vec<_> = index
        .chats
        .iter()
        .filter(|c| c.is_archived == Some(true))
        .collect();

    chats.sort_by(|a, b| {
        let a_time = a.archived_at.unwrap_or(a.updated_at);
        let b_time = b.archived_at.unwrap_or(b.updated_at);
        b_time.cmp(&a_time)
    });
    chats
}

// ============================================================================
// Workspace State Operations
// ============================================================================

/// Save workspace state to disk.
///
/// Writes to `workspace.json` in the workspace directory.
pub fn save_workspace_state(dir: &Path, state: &WorkspaceState) -> Result<(), IndexError> {
    fs::create_dir_all(dir)?;

    let file_path = dir.join("workspace.json");
    let temp_path = dir.join("workspace.json.tmp");

    let json = serde_json::to_string_pretty(state)?;
    fs::write(&temp_path, json)?;
    fs::rename(&temp_path, &file_path)?;

    Ok(())
}

/// Load workspace state from disk.
///
/// Returns default state if file doesn't exist.
/// Also supports legacy `index.json` format.
pub fn load_workspace_state(dir: &Path) -> Result<WorkspaceState, IndexError> {
    let file_path = dir.join("workspace.json");
    let legacy_path = dir.join("index.json");

    // Try workspace.json first
    if file_path.exists() {
        let contents = fs::read_to_string(&file_path)?;
        let state: WorkspaceState = serde_json::from_str(&contents)?;
        return Ok(state);
    }

    // Fall back to legacy index.json
    if legacy_path.exists() {
        let contents = fs::read_to_string(&legacy_path)?;
        // Legacy format might have different structure, try to parse
        if let Ok(state) = serde_json::from_str::<WorkspaceState>(&contents) {
            return Ok(state);
        }
        // If legacy format differs, return default
    }

    Ok(WorkspaceState::default())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;

    fn make_entry(id: &str, label: &str) -> ChatIndexEntry {
        ChatIndexEntry {
            id: id.to_string(),
            label: label.to_string(),
            agent_type: Some("claude".to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_archived: None,
            archived_at: None,
        }
    }

    #[test]
    fn save_and_load_index() {
        let dir = tempdir().unwrap();
        let index = ChatIndex {
            chats: vec![make_entry("chat-1", "Test Chat")],
        };

        save_chat_index(dir.path(), &index).unwrap();
        let loaded = load_chat_index(dir.path()).unwrap();

        assert_eq!(loaded.chats.len(), 1);
        assert_eq!(loaded.chats[0].id, "chat-1");
    }

    #[test]
    fn load_nonexistent_index_returns_empty() {
        let dir = tempdir().unwrap();
        let loaded = load_chat_index(dir.path()).unwrap();

        assert!(loaded.chats.is_empty());
    }

    #[test]
    fn upsert_adds_new_entry() {
        let mut index = ChatIndex::default();

        upsert_chat_entry(&mut index, make_entry("chat-1", "First"));
        upsert_chat_entry(&mut index, make_entry("chat-2", "Second"));

        assert_eq!(index.chats.len(), 2);
    }

    #[test]
    fn upsert_replaces_existing_entry() {
        let mut index = ChatIndex::default();

        upsert_chat_entry(&mut index, make_entry("chat-1", "Original"));
        upsert_chat_entry(&mut index, make_entry("chat-1", "Updated"));

        assert_eq!(index.chats.len(), 1);
        assert_eq!(index.chats[0].label, "Updated");
    }

    #[test]
    fn remove_entry() {
        let mut index = ChatIndex {
            chats: vec![
                make_entry("chat-1", "First"),
                make_entry("chat-2", "Second"),
            ],
        };

        remove_chat_entry(&mut index, "chat-1");

        assert_eq!(index.chats.len(), 1);
        assert_eq!(index.chats[0].id, "chat-2");
    }

    #[test]
    fn find_entry() {
        let index = ChatIndex {
            chats: vec![
                make_entry("chat-1", "First"),
                make_entry("chat-2", "Second"),
            ],
        };

        let found = find_chat_entry(&index, "chat-2");
        assert!(found.is_some());
        assert_eq!(found.unwrap().label, "Second");

        let not_found = find_chat_entry(&index, "chat-3");
        assert!(not_found.is_none());
    }

    #[test]
    fn get_active_chats_excludes_archived() {
        let mut archived = make_entry("archived", "Archived Chat");
        archived.is_archived = Some(true);

        let index = ChatIndex {
            chats: vec![make_entry("active", "Active Chat"), archived],
        };

        let active = get_active_chats(&index);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "active");
    }

    #[test]
    fn get_archived_chats_only_archived() {
        let mut archived = make_entry("archived", "Archived Chat");
        archived.is_archived = Some(true);

        let index = ChatIndex {
            chats: vec![make_entry("active", "Active Chat"), archived],
        };

        let archived_list = get_archived_chats(&index);
        assert_eq!(archived_list.len(), 1);
        assert_eq!(archived_list[0].id, "archived");
    }

    #[test]
    fn save_and_load_workspace_state() {
        let dir = tempdir().unwrap();
        let state = WorkspaceState {
            active_chat_id: Some("chat-1".to_string()),
        };

        save_workspace_state(dir.path(), &state).unwrap();
        let loaded = load_workspace_state(dir.path()).unwrap();

        assert_eq!(loaded.active_chat_id, Some("chat-1".to_string()));
    }

    #[test]
    fn load_nonexistent_workspace_state_returns_default() {
        let dir = tempdir().unwrap();
        let loaded = load_workspace_state(dir.path()).unwrap();

        assert!(loaded.active_chat_id.is_none());
    }

    #[test]
    fn load_workspace_state_from_legacy_index() {
        let dir = tempdir().unwrap();

        // Write legacy index.json
        let legacy = r#"{"activeChatId": "legacy-chat"}"#;
        fs::write(dir.path().join("index.json"), legacy).unwrap();

        let loaded = load_workspace_state(dir.path()).unwrap();
        assert_eq!(loaded.active_chat_id, Some("legacy-chat".to_string()));
    }

    #[test]
    fn workspace_state_prefers_workspace_json() {
        let dir = tempdir().unwrap();

        // Write both files
        let legacy = r#"{"activeChatId": "legacy-chat"}"#;
        fs::write(dir.path().join("index.json"), legacy).unwrap();

        let state = WorkspaceState {
            active_chat_id: Some("new-chat".to_string()),
        };
        save_workspace_state(dir.path(), &state).unwrap();

        let loaded = load_workspace_state(dir.path()).unwrap();
        assert_eq!(loaded.active_chat_id, Some("new-chat".to_string()));
    }
}
