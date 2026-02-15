//! Chat file persistence operations.
//!
//! # File Structure
//!
//! Individual chats are saved to:
//! ```text
//! ~/.config/overseer/chats/{project_name}/{workspace_name}/{chat_id}.json
//! ```
//!
//! # Design Notes
//!
//! - **Atomic writes**: Write to temp file, then rename (prevents corruption)
//! - **Lazy loading**: Messages loaded on-demand via `load_chat`
//! - **Debounced saves**: Caller should debounce to prevent excessive I/O

use std::fs;
use std::path::Path;

use super::types::ChatFile;

/// Error type for chat persistence operations.
#[derive(Debug)]
pub enum ChatError {
    /// IO error (file not found, permission denied, etc.)
    Io(std::io::Error),
    /// JSON serialization/deserialization error
    Json(serde_json::Error),
    /// Chat not found
    NotFound(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::Io(e) => write!(f, "IO error: {e}"),
            ChatError::Json(e) => write!(f, "JSON error: {e}"),
            ChatError::NotFound(id) => write!(f, "Chat not found: {id}"),
        }
    }
}

impl std::error::Error for ChatError {}

impl From<std::io::Error> for ChatError {
    fn from(e: std::io::Error) -> Self {
        ChatError::Io(e)
    }
}

impl From<serde_json::Error> for ChatError {
    fn from(e: serde_json::Error) -> Self {
        ChatError::Json(e)
    }
}

/// Save a chat to disk.
///
/// # Atomic Write Strategy
///
/// 1. Write to `{chat_id}.json.tmp`
/// 2. Rename to `{chat_id}.json`
///
/// This prevents data corruption if the write is interrupted.
///
/// # Arguments
///
/// * `dir` - The workspace chat directory
/// * `chat` - The chat to save
///
/// # Example
///
/// ```ignore
/// let dir = Path::new("/home/user/.config/overseer/chats/myproject/main");
/// save_chat(&dir, &chat)?;
/// ```
pub fn save_chat(dir: &Path, chat: &ChatFile) -> Result<(), ChatError> {
    // Ensure directory exists
    fs::create_dir_all(dir)?;

    let file_path = dir.join(format!("{}.json", chat.id));
    let temp_path = dir.join(format!("{}.json.tmp", chat.id));

    // Write to temp file first
    let json = serde_json::to_string_pretty(chat)?;
    fs::write(&temp_path, json)?;

    // Atomic rename
    fs::rename(&temp_path, &file_path)?;

    Ok(())
}

/// Load a chat from disk.
///
/// # Arguments
///
/// * `dir` - The workspace chat directory
/// * `chat_id` - The chat ID to load
///
/// # Returns
///
/// The loaded chat, or `ChatError::NotFound` if it doesn't exist.
pub fn load_chat(dir: &Path, chat_id: &str) -> Result<ChatFile, ChatError> {
    let file_path = dir.join(format!("{chat_id}.json"));

    if !file_path.exists() {
        return Err(ChatError::NotFound(chat_id.to_string()));
    }

    let contents = fs::read_to_string(&file_path)?;
    let chat: ChatFile = serde_json::from_str(&contents)?;

    Ok(chat)
}

/// Delete a chat from disk.
///
/// # Arguments
///
/// * `dir` - The workspace chat directory
/// * `chat_id` - The chat ID to delete
///
/// # Returns
///
/// `Ok(())` if deleted or didn't exist, `Err` on I/O error.
pub fn delete_chat(dir: &Path, chat_id: &str) -> Result<(), ChatError> {
    let file_path = dir.join(format!("{chat_id}.json"));

    if file_path.exists() {
        fs::remove_file(&file_path)?;
    }

    Ok(())
}

/// Check if a chat file exists.
pub fn chat_exists(dir: &Path, chat_id: &str) -> bool {
    let file_path = dir.join(format!("{chat_id}.json"));
    file_path.exists()
}

/// List all chat IDs in a directory.
///
/// Finds all `*.json` files that aren't special files
/// (workspace.json, chats.json, approvals.json).
pub fn list_chat_ids(dir: &Path) -> Result<Vec<String>, ChatError> {
    let mut ids = Vec::new();

    if !dir.exists() {
        return Ok(ids);
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                // Skip special files
                if stem != "workspace" && stem != "chats" && stem != "approvals" {
                    // Skip temp files
                    if !stem.ends_with(".tmp") {
                        ids.push(stem.to_string());
                    }
                }
            }
        }
    }

    Ok(ids)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;

    fn make_test_chat(id: &str) -> ChatFile {
        ChatFile {
            id: id.to_string(),
            workspace_id: "ws-1".to_string(),
            label: "Test Chat".to_string(),
            messages: vec![],
            agent_type: Some("claude".to_string()),
            agent_session_id: None,
            model_version: None,
            permission_mode: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn save_and_load_chat() {
        let dir = tempdir().unwrap();
        let chat = make_test_chat("chat-1");

        save_chat(dir.path(), &chat).unwrap();
        let loaded = load_chat(dir.path(), "chat-1").unwrap();

        assert_eq!(loaded.id, "chat-1");
        assert_eq!(loaded.label, "Test Chat");
    }

    #[test]
    fn load_nonexistent_chat() {
        let dir = tempdir().unwrap();
        let result = load_chat(dir.path(), "nonexistent");

        assert!(matches!(result, Err(ChatError::NotFound(_))));
    }

    #[test]
    fn delete_chat_removes_file() {
        let dir = tempdir().unwrap();
        let chat = make_test_chat("chat-to-delete");

        save_chat(dir.path(), &chat).unwrap();
        assert!(chat_exists(dir.path(), "chat-to-delete"));

        delete_chat(dir.path(), "chat-to-delete").unwrap();
        assert!(!chat_exists(dir.path(), "chat-to-delete"));
    }

    #[test]
    fn delete_nonexistent_chat_succeeds() {
        let dir = tempdir().unwrap();
        let result = delete_chat(dir.path(), "nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn list_chat_ids_finds_chats() {
        let dir = tempdir().unwrap();

        save_chat(dir.path(), &make_test_chat("chat-1")).unwrap();
        save_chat(dir.path(), &make_test_chat("chat-2")).unwrap();

        let ids = list_chat_ids(dir.path()).unwrap();

        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"chat-1".to_string()));
        assert!(ids.contains(&"chat-2".to_string()));
    }

    #[test]
    fn list_chat_ids_excludes_special_files() {
        let dir = tempdir().unwrap();

        // Create chat file
        save_chat(dir.path(), &make_test_chat("real-chat")).unwrap();

        // Create special files
        fs::write(dir.path().join("workspace.json"), "{}").unwrap();
        fs::write(dir.path().join("chats.json"), "{}").unwrap();
        fs::write(dir.path().join("approvals.json"), "{}").unwrap();

        let ids = list_chat_ids(dir.path()).unwrap();

        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0], "real-chat");
    }

    #[test]
    fn atomic_write_creates_no_temp_file() {
        let dir = tempdir().unwrap();
        let chat = make_test_chat("atomic-test");

        save_chat(dir.path(), &chat).unwrap();

        // Temp file should not exist after successful save
        let temp_path = dir.path().join("atomic-test.json.tmp");
        assert!(!temp_path.exists());

        // Real file should exist
        let real_path = dir.path().join("atomic-test.json");
        assert!(real_path.exists());
    }

    #[test]
    fn chat_exists_returns_correct_values() {
        let dir = tempdir().unwrap();

        assert!(!chat_exists(dir.path(), "chat-1"));

        save_chat(dir.path(), &make_test_chat("chat-1")).unwrap();

        assert!(chat_exists(dir.path(), "chat-1"));
        assert!(!chat_exists(dir.path(), "chat-2"));
    }
}
