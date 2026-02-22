//! Chat session persistence manager (JSONL-based).
//!
//! Manages active chat sessions with buffered writes for performance.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use uuid::Uuid;

use crate::agents::event::AgentEvent;
use crate::persistence::chat_jsonl::{
    count_events, load_chat_events as load_chat_events_jsonl,
    load_chat_events_since_seq as load_events_since_seq_jsonl,
    load_chat_events_with_seq as load_events_with_seq_jsonl,
    load_chat_metadata as load_chat_metadata_jsonl, save_chat_metadata as save_chat_metadata_jsonl,
    serialize_event_for_storage, SeqEvent,
};
use crate::persistence::types::ChatMetadata;

const MAX_PENDING_EVENTS: usize = 10;
const FLUSH_INTERVAL: Duration = Duration::from_secs(2);

/// Manages chat session persistence with buffered writes.
///
/// Thread-safe manager that handles:
/// - Session registration and unregistration
/// - Event appending with automatic flushing
/// - Chat metadata and event loading
#[derive(Default)]
pub struct ChatSessionManager {
    /// Active chat sessions: chat_id -> Arc<Mutex<ChatSession>>
    sessions: Mutex<HashMap<String, Arc<Mutex<ChatSession>>>>,
    /// Config directory for persistence
    config_dir: Mutex<Option<PathBuf>>,
}

impl ChatSessionManager {
    /// Create a new ChatSessionManager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the config directory for persistence.
    pub fn set_config_dir(&self, dir: PathBuf) {
        *self.config_dir.lock().unwrap() = Some(dir);
    }

    /// Get the config directory.
    pub fn config_dir(&self) -> Option<PathBuf> {
        self.config_dir.lock().unwrap().clone()
    }

    fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Result<PathBuf, String> {
        // Validate path components to prevent path traversal
        Self::validate_path_component(project_name)?;
        Self::validate_path_component(workspace_name)?;

        self.config_dir
            .lock()
            .unwrap()
            .as_ref()
            .map(|dir| dir.join("chats").join(project_name).join(workspace_name))
            .ok_or_else(|| "Config directory not set".to_string())
    }

    fn validate_path_component(component: &str) -> Result<(), String> {
        // Reject empty, path separators, and non-normal components
        if component.is_empty() {
            return Err("Path component cannot be empty".to_string());
        }

        let path = std::path::Path::new(component);
        let mut components = path.components();

        match components.next() {
            Some(Component::Normal(_)) if components.next().is_none() => Ok(()),
            _ => Err(format!("Invalid path component: {component}")),
        }
    }

    /// Register a new chat session for persistence.
    pub fn register_session(
        &self,
        chat_id: String,
        project_name: String,
        workspace_name: String,
        metadata: ChatMetadata,
    ) -> Result<(), String> {
        if metadata.id != chat_id {
            return Err("Chat metadata ID does not match chat_id".to_string());
        }

        let dir = self.get_chat_dir(&project_name, &workspace_name)?;
        save_chat_metadata_jsonl(&dir, &metadata).map_err(|e| e.to_string())?;

        let mut sessions = self.sessions.lock().unwrap();
        if sessions.contains_key(&chat_id) {
            return Ok(());
        }

        // Count existing events to initialize seq counter
        let initial_event_count = count_events(&dir, &chat_id).unwrap_or(0);

        sessions.insert(
            chat_id.clone(),
            Arc::new(Mutex::new(ChatSession::new(
                chat_id,
                dir,
                initial_event_count,
            ))),
        );

        Ok(())
    }

    /// Unregister a chat session and flush pending events.
    pub fn unregister_session(&self, chat_id: &str) -> Result<(), String> {
        // Remove session while holding lock, then drop lock before I/O
        let session_opt = {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.remove(chat_id)
        };

        if let Some(session) = session_opt {
            let mut session = session.lock().unwrap();
            session.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Append an event to a chat session.
    ///
    /// For backwards compatibility, this doesn't return the seq.
    /// Use `append_event_with_seq` if you need the seq number.
    pub fn append_event(&self, chat_id: &str, event: AgentEvent) -> Result<(), String> {
        self.append_event_with_seq(chat_id, event).map(|_| ())
    }

    /// Append an event to a chat session and return its sequence number.
    ///
    /// The sequence number is the 1-indexed line number in the JSONL file.
    pub fn append_event_with_seq(&self, chat_id: &str, event: AgentEvent) -> Result<u64, String> {
        // Look up session under global lock, then release before I/O
        let session = {
            let sessions = self.sessions.lock().unwrap();
            sessions
                .get(chat_id)
                .cloned()
                .ok_or_else(|| format!("Chat session not registered: {chat_id}"))?
        };

        let mut session = session.lock().unwrap();
        session.append_event(event).map_err(|e| e.to_string())
    }

    /// Load all events from a chat session.
    pub fn load_events(
        &self,
        project_name: &str,
        workspace_name: &str,
        chat_id: &str,
    ) -> Result<Vec<AgentEvent>, String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        load_chat_events_jsonl(&dir, chat_id).map_err(|e| e.to_string())
    }

    /// Load all events from a chat session with their sequence numbers.
    pub fn load_events_with_seq(
        &self,
        project_name: &str,
        workspace_name: &str,
        chat_id: &str,
    ) -> Result<Vec<SeqEvent>, String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        load_events_with_seq_jsonl(&dir, chat_id).map_err(|e| e.to_string())
    }

    /// Load events from a chat session with seq > since_seq.
    pub fn load_events_since_seq(
        &self,
        project_name: &str,
        workspace_name: &str,
        chat_id: &str,
        since_seq: u64,
    ) -> Result<Vec<SeqEvent>, String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        load_events_since_seq_jsonl(&dir, chat_id, since_seq).map_err(|e| e.to_string())
    }

    /// Load chat metadata for a session.
    pub fn load_metadata(
        &self,
        project_name: &str,
        workspace_name: &str,
        chat_id: &str,
    ) -> Result<ChatMetadata, String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        load_chat_metadata_jsonl(&dir, chat_id).map_err(|e| e.to_string())
    }

    /// Save chat metadata for a session.
    pub fn save_metadata(
        &self,
        project_name: &str,
        workspace_name: &str,
        metadata: ChatMetadata,
    ) -> Result<(), String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        save_chat_metadata_jsonl(&dir, &metadata).map_err(|e| e.to_string())
    }

    /// Add a user message to a chat session.
    pub fn add_user_message(
        &self,
        chat_id: &str,
        content: String,
        meta: Option<serde_json::Value>,
    ) -> Result<AgentEvent, String> {
        let event = AgentEvent::UserMessage {
            id: Uuid::new_v4().to_string(),
            content,
            timestamp: Utc::now(),
            meta,
        };
        self.append_event(chat_id, event.clone())?;
        Ok(event)
    }
}

/// Internal chat session state.
struct ChatSession {
    pending_events: Vec<AgentEvent>,
    file_handle: Option<std::io::BufWriter<std::fs::File>>,
    last_flush: Instant,
    jsonl_path: PathBuf,
    /// Next sequence number to assign (1-indexed, corresponds to line number)
    next_seq: u64,
}

impl ChatSession {
    fn new(chat_id: String, dir: PathBuf, initial_event_count: u64) -> Self {
        let jsonl_path = dir.join(format!("{chat_id}.jsonl"));
        Self {
            pending_events: Vec::new(),
            file_handle: None,
            last_flush: Instant::now(),
            jsonl_path,
            // Start from the next line number after existing events
            next_seq: initial_event_count + 1,
        }
    }

    fn append_event(&mut self, event: AgentEvent) -> Result<u64, std::io::Error> {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.pending_events.push(event);
        if self.should_flush() {
            self.flush()?;
        }
        Ok(seq)
    }

    fn should_flush(&self) -> bool {
        self.pending_events.len() >= MAX_PENDING_EVENTS
            || self.last_flush.elapsed() >= FLUSH_INTERVAL
    }

    fn flush(&mut self) -> Result<(), std::io::Error> {
        if self.pending_events.is_empty() {
            return Ok(());
        }

        if self.file_handle.is_none() {
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.jsonl_path)?;
            self.file_handle = Some(std::io::BufWriter::new(file));
        }

        let writer = self
            .file_handle
            .as_mut()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "Missing file handle"))?;

        for event in self.pending_events.drain(..) {
            let line = serialize_event_for_storage(&event)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            writeln!(writer, "{line}")?;
        }

        writer.flush()?;
        writer.get_ref().sync_all()?;
        self.last_flush = Instant::now();

        Ok(())
    }
}

// ============================================================================
// TESTS
// ============================================================================
//
// The #[cfg(test)] attribute tells Rust to only compile this module when
// running `cargo test`. This keeps test code out of production builds.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{sample_chat_metadata, sample_user_message, TestChatDir};

    // ------------------------------------------------------------------------
    // Path Validation Tests (Security Critical)
    // ------------------------------------------------------------------------
    //
    // These tests verify that `validate_path_component` blocks path traversal
    // attacks. A malicious project_name like "../../../etc" could let an
    // attacker read/write files outside the chat directory.

    #[test]
    fn validate_path_component_rejects_empty() {
        // Empty strings would create invalid paths like "/chats//workspace"
        let result = ChatSessionManager::validate_path_component("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn validate_path_component_rejects_dot_dot() {
        // ".." is the classic path traversal attack - go up a directory
        let result = ChatSessionManager::validate_path_component("..");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_component_rejects_absolute_path() {
        // Absolute paths like "/etc/passwd" would bypass the chat directory
        let result = ChatSessionManager::validate_path_component("/foo");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_component_rejects_slash() {
        // Slashes would create nested paths: "foo/bar" -> ".../foo/bar/..."
        let result = ChatSessionManager::validate_path_component("foo/bar");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_component_accepts_normal_name() {
        // Normal directory names should work
        let result = ChatSessionManager::validate_path_component("my-project");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_component_accepts_hyphen_underscore() {
        // Hyphens and underscores are common in project names
        let result = ChatSessionManager::validate_path_component("my_project-1");
        assert!(result.is_ok());
    }

    // ------------------------------------------------------------------------
    // Session Lifecycle Tests
    // ------------------------------------------------------------------------
    //
    // These tests verify session registration, unregistration, and the
    // interactions between them. Sessions are the core abstraction for
    // tracking active chats.

    #[test]
    fn register_session_creates_metadata_file() {
        // TestChatDir creates a temp directory that auto-deletes when dropped.
        // This is a common Rust pattern for test cleanup - use RAII (Resource
        // Acquisition Is Initialization) to tie cleanup to scope exit.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");

        // Register should succeed and create the metadata file
        let result = manager.register_session(
            "chat-123".to_string(),
            "test-project".to_string(),
            "test-workspace".to_string(),
            metadata,
        );
        assert!(result.is_ok());

        // Verify metadata file exists on disk
        let metadata_path = test_dir
            .path()
            .join("chats/test-project/test-workspace/chat-123.meta.json");
        assert!(metadata_path.exists(), "Metadata file should be created");
    }

    #[test]
    fn register_session_with_mismatched_id_fails() {
        // The metadata.id must match the chat_id parameter - this prevents
        // accidentally saving metadata to the wrong file.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("different-id");

        let result = manager.register_session(
            "chat-123".to_string(), // Different from metadata.id!
            "test-project".to_string(),
            "test-workspace".to_string(),
            metadata,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not match"));
    }

    #[test]
    fn register_session_twice_is_idempotent() {
        // Double-registering the same session shouldn't error - this can
        // happen if the UI reconnects or reloads.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");

        // First registration
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata.clone(),
            )
            .unwrap();

        // Second registration - should succeed (idempotent)
        let result = manager.register_session(
            "chat-123".to_string(),
            "test-project".to_string(),
            "test-workspace".to_string(),
            metadata,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn unregister_session_flushes_pending_events() {
        // When a session is unregistered (user closes chat), we must flush
        // any buffered events to disk to avoid data loss.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Append an event (won't auto-flush because we're under MAX_PENDING_EVENTS)
        let event = sample_user_message("Hello!");
        manager.append_event("chat-123", event).unwrap();

        // Unregister should flush to disk
        manager.unregister_session("chat-123").unwrap();

        // Verify event was persisted
        let events = manager
            .load_events("test-project", "test-workspace", "chat-123")
            .unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn unregister_nonexistent_session_returns_ok() {
        // Unregistering an unknown session shouldn't error - makes cleanup
        // code simpler (no need to check if session exists first).
        let manager = ChatSessionManager::new();

        let result = manager.unregister_session("unknown-session");
        assert!(result.is_ok());
    }

    // ------------------------------------------------------------------------
    // Event Appending Tests
    // ------------------------------------------------------------------------
    //
    // Events are appended to sessions and buffered in memory until flushed.
    // Each event gets a sequence number (1-indexed line number in the JSONL).

    #[test]
    fn append_event_to_registered_session() {
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Append should succeed for registered sessions
        let event = sample_user_message("Hello!");
        let result = manager.append_event("chat-123", event);
        assert!(result.is_ok());
    }

    #[test]
    fn append_event_to_unregistered_session_fails() {
        // Can't append to sessions we don't know about - forces explicit
        // registration which ensures metadata is saved first.
        let manager = ChatSessionManager::new();

        let event = sample_user_message("Hello!");
        let result = manager.append_event("unknown-chat", event);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not registered"));
    }

    #[test]
    fn append_event_returns_sequential_seq_numbers() {
        // Sequence numbers start at 1 and increment for each event.
        // These correspond to line numbers in the JSONL file.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Each append should return incrementing seq numbers
        let seq1 = manager
            .append_event_with_seq("chat-123", sample_user_message("First"))
            .unwrap();
        let seq2 = manager
            .append_event_with_seq("chat-123", sample_user_message("Second"))
            .unwrap();
        let seq3 = manager
            .append_event_with_seq("chat-123", sample_user_message("Third"))
            .unwrap();

        assert_eq!(seq1, 1);
        assert_eq!(seq2, 2);
        assert_eq!(seq3, 3);
    }

    #[test]
    fn append_event_seq_starts_from_existing_count() {
        // When resuming a session, seq should continue from where we left off.
        // This test writes events, re-registers, and verifies seq continues.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");

        // First session: append 3 events and flush
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata.clone(),
            )
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("One"))
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("Two"))
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("Three"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap(); // Flushes to disk

        // Re-register the same session (simulates app restart)
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Next seq should be 4 (continuing from the 3 existing events)
        let seq = manager
            .append_event_with_seq("chat-123", sample_user_message("Four"))
            .unwrap();
        assert_eq!(seq, 4);
    }

    // ------------------------------------------------------------------------
    // Flush Behavior Tests
    // ------------------------------------------------------------------------
    //
    // Events are buffered in memory for performance and flushed to disk when:
    // 1. MAX_PENDING_EVENTS (10) is reached (count-based trigger)
    // 2. FLUSH_INTERVAL (2s) has passed (time-based trigger - not tested)
    // 3. Session is unregistered (explicit flush)

    #[test]
    fn flush_triggers_at_max_pending_events() {
        // After 10 events, the buffer should auto-flush to disk.
        // We verify this by checking the JSONL file exists after 10 appends.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        let jsonl_path = test_dir
            .path()
            .join("chats/test-project/test-workspace/chat-123.jsonl");

        // Append 9 events - should NOT trigger flush yet
        for i in 0..9 {
            manager
                .append_event("chat-123", sample_user_message(&format!("Message {}", i)))
                .unwrap();
        }
        assert!(!jsonl_path.exists(), "Should not flush before 10 events");

        // 10th event should trigger flush
        manager
            .append_event("chat-123", sample_user_message("Message 10"))
            .unwrap();
        assert!(jsonl_path.exists(), "Should flush at 10 events");
    }

    #[test]
    fn flush_creates_file_on_first_write() {
        // The JSONL file is created lazily - only when we actually flush.
        // This avoids creating empty files for sessions with no events.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        let jsonl_path = test_dir
            .path()
            .join("chats/test-project/test-workspace/chat-123.jsonl");

        // Before any events, no JSONL file
        assert!(!jsonl_path.exists());

        // Append and flush
        manager
            .append_event("chat-123", sample_user_message("Hello"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap();

        // Now the file should exist
        assert!(jsonl_path.exists());
    }

    #[test]
    fn flush_appends_to_existing_file() {
        // Multiple flushes should append, not overwrite.
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata.clone(),
            )
            .unwrap();

        // First batch
        manager
            .append_event("chat-123", sample_user_message("First"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap();

        // Re-register and add more
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("Second"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap();

        // Should have 2 events total
        let events = manager
            .load_events("test-project", "test-workspace", "chat-123")
            .unwrap();
        assert_eq!(events.len(), 2);
    }

    // ------------------------------------------------------------------------
    // Loading Events Tests
    // ------------------------------------------------------------------------
    //
    // These tests verify that events can be persisted and loaded back
    // correctly (round-trip testing).

    #[test]
    fn load_events_returns_persisted_events() {
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Add events and flush
        manager
            .append_event("chat-123", sample_user_message("Hello"))
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("World"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap();

        // Load and verify
        let events = manager
            .load_events("test-project", "test-workspace", "chat-123")
            .unwrap();
        assert_eq!(events.len(), 2);

        // Verify event content by matching on the enum variant
        // In Rust, we use `if let` or `match` to destructure enums
        if let AgentEvent::UserMessage { content, .. } = &events[0] {
            assert_eq!(content, "Hello");
        } else {
            panic!("Expected UserMessage event");
        }
    }

    #[test]
    fn load_events_with_seq_returns_seq_numbers() {
        // load_events_with_seq returns SeqEvent which includes the line number
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        manager
            .append_event("chat-123", sample_user_message("First"))
            .unwrap();
        manager
            .append_event("chat-123", sample_user_message("Second"))
            .unwrap();
        manager.unregister_session("chat-123").unwrap();

        // Load with seq numbers
        let seq_events = manager
            .load_events_with_seq("test-project", "test-workspace", "chat-123")
            .unwrap();
        assert_eq!(seq_events.len(), 2);
        assert_eq!(seq_events[0].seq, 1);
        assert_eq!(seq_events[1].seq, 2);
    }

    #[test]
    fn load_events_since_seq_filters_correctly() {
        // load_events_since_seq is used for incremental sync - only get new events
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Add 5 events
        for i in 1..=5 {
            manager
                .append_event("chat-123", sample_user_message(&format!("Message {}", i)))
                .unwrap();
        }
        manager.unregister_session("chat-123").unwrap();

        // Load events since seq 3 (should get events 4 and 5)
        let events = manager
            .load_events_since_seq("test-project", "test-workspace", "chat-123", 3)
            .unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].seq, 4);
        assert_eq!(events[1].seq, 5);
    }

    #[test]
    fn load_metadata_returns_saved_metadata() {
        let test_dir = TestChatDir::new();
        let manager = ChatSessionManager::new();
        manager.set_config_dir(test_dir.path().to_path_buf());

        let metadata = sample_chat_metadata("chat-123");
        manager
            .register_session(
                "chat-123".to_string(),
                "test-project".to_string(),
                "test-workspace".to_string(),
                metadata,
            )
            .unwrap();

        // Load metadata back
        let loaded = manager
            .load_metadata("test-project", "test-workspace", "chat-123")
            .unwrap();
        assert_eq!(loaded.id, "chat-123");
    }
}
