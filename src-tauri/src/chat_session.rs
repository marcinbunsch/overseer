//! Chat session persistence manager (JSONL-based).

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use overseer_core::agents::event::AgentEvent;
use overseer_core::persistence::chat_jsonl::{
    load_chat_events as load_chat_events_jsonl, save_chat_metadata, serialize_event_for_storage,
};
use overseer_core::persistence::types::ChatMetadata;
use tauri::State;

const MAX_PENDING_EVENTS: usize = 10;
const FLUSH_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct ChatSessionManager {
    /// Active chat sessions: chat_id -> ChatSession
    sessions: Mutex<HashMap<String, ChatSession>>,
    /// Config directory for persistence
    config_dir: Mutex<Option<PathBuf>>,
}

impl ChatSessionManager {
    /// Set the config directory for persistence.
    pub fn set_config_dir(&self, dir: PathBuf) {
        *self.config_dir.lock().unwrap() = Some(dir);
    }

    fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Result<PathBuf, String> {
        self.config_dir
            .lock()
            .unwrap()
            .as_ref()
            .map(|dir| dir.join("chats").join(project_name).join(workspace_name))
            .ok_or_else(|| "Config directory not set".to_string())
    }

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
        save_chat_metadata(&dir, &metadata).map_err(|e| e.to_string())?;

        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(
            chat_id.clone(),
            ChatSession::new(chat_id, project_name, workspace_name, dir),
        );

        Ok(())
    }

    pub fn unregister_session(&self, chat_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(chat_id) {
            session.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn append_event(&self, chat_id: &str, event: AgentEvent) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(chat_id)
            .ok_or_else(|| format!("Chat session not registered: {chat_id}"))?;
        session.append_event(event).map_err(|e| e.to_string())
    }

    pub fn load_events(
        &self,
        project_name: &str,
        workspace_name: &str,
        chat_id: &str,
    ) -> Result<Vec<AgentEvent>, String> {
        let dir = self.get_chat_dir(project_name, workspace_name)?;
        load_chat_events_jsonl(&dir, chat_id).map_err(|e| e.to_string())
    }
}

struct ChatSession {
    chat_id: String,
    project_name: String,
    workspace_name: String,
    pending_events: Vec<AgentEvent>,
    file_handle: Option<std::io::BufWriter<std::fs::File>>,
    last_flush: Instant,
    jsonl_path: PathBuf,
}

impl ChatSession {
    fn new(
        chat_id: String,
        project_name: String,
        workspace_name: String,
        dir: PathBuf,
    ) -> Self {
        let jsonl_path = dir.join(format!("{chat_id}.jsonl"));
        Self {
            chat_id,
            project_name,
            workspace_name,
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
        writer
            .get_ref()
            .sync_all()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        self.last_flush = Instant::now();

        Ok(())
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Register a chat session for persistence.
#[tauri::command]
pub async fn register_chat_session(
    state: State<'_, ChatSessionManager>,
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
    state: State<'_, ChatSessionManager>,
    chat_id: String,
) -> Result<(), String> {
    state.unregister_session(&chat_id)
}

/// Append an event to a chat session.
#[tauri::command]
pub async fn append_chat_event(
    state: State<'_, ChatSessionManager>,
    chat_id: String,
    event: AgentEvent,
) -> Result<(), String> {
    state.append_event(&chat_id, event)
}

/// Load all events from a chat session.
#[tauri::command]
pub async fn load_chat_events(
    state: State<'_, ChatSessionManager>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<Vec<AgentEvent>, String> {
    state.load_events(&project_name, &workspace_name, &chat_id)
}
