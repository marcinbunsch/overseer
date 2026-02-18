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
    load_chat_events as load_chat_events_jsonl, load_chat_metadata as load_chat_metadata_jsonl,
    save_chat_metadata as save_chat_metadata_jsonl, serialize_event_for_storage,
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

        sessions.insert(
            chat_id.clone(),
            Arc::new(Mutex::new(ChatSession::new(chat_id, dir))),
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
    pub fn append_event(&self, chat_id: &str, event: AgentEvent) -> Result<(), String> {
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
}

impl ChatSession {
    fn new(chat_id: String, dir: PathBuf) -> Self {
        let jsonl_path = dir.join(format!("{chat_id}.jsonl"));
        Self {
            pending_events: Vec::new(),
            file_handle: None,
            last_flush: Instant::now(),
            jsonl_path,
        }
    }

    fn append_event(&mut self, event: AgentEvent) -> Result<(), std::io::Error> {
        self.pending_events.push(event);
        if self.should_flush() {
            self.flush()?;
        }
        Ok(())
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
