//! SessionManager - the heart of process sharing across interfaces.

use super::state::{Session, SessionId};
use std::collections::HashMap;
use thiserror::Error;

/// Unique identifier for an event subscriber.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SubscriberId(pub String);

/// Configuration for creating a new session.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub working_dir: String,
    pub agent_type: String,
    pub model: Option<String>,
}

/// Handle to an attached session.
pub struct SessionHandle {
    pub session_id: SessionId,
    pub subscriber_id: SubscriberId,
}

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("Session not found: {0}")]
    NotFound(SessionId),

    #[error("Session already exists: {0}")]
    AlreadyExists(SessionId),

    #[error("Failed to spawn agent: {0}")]
    SpawnFailed(String),
}

/// Manages all active sessions, allowing sharing across interfaces.
///
/// Each interface (Tauri, SSH, Web) creates a SessionManager at startup
/// and passes it to handlers. Multiple interfaces in the same process
/// share the same SessionManager instance.
pub struct SessionManager {
    sessions: HashMap<SessionId, Session>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Create a new session, returns ID for future reference.
    pub fn create_session(&mut self, config: SessionConfig) -> SessionId {
        let id = SessionId::new();
        let session = Session::new(id.clone(), config.working_dir, config.agent_type);
        self.sessions.insert(id.clone(), session);
        id
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: &SessionId) -> Option<&Session> {
        self.sessions.get(session_id)
    }

    /// Get a mutable session by ID.
    pub fn get_session_mut(&mut self, session_id: &SessionId) -> Option<&mut Session> {
        self.sessions.get_mut(session_id)
    }

    /// Attach to an existing session (e.g., from web after starting in Tauri).
    pub fn attach(
        &mut self,
        session_id: SessionId,
        subscriber_id: SubscriberId,
    ) -> Result<SessionHandle, SessionError> {
        if !self.sessions.contains_key(&session_id) {
            return Err(SessionError::NotFound(session_id));
        }

        // TODO: Add subscriber to session's subscriber list
        // For now, just return a handle

        Ok(SessionHandle {
            session_id,
            subscriber_id,
        })
    }

    /// Detach from a session (session keeps running).
    pub fn detach(
        &mut self,
        session_id: &SessionId,
        _subscriber_id: &SubscriberId,
    ) -> Result<(), SessionError> {
        if !self.sessions.contains_key(session_id) {
            return Err(SessionError::NotFound(session_id.clone()));
        }

        // TODO: Remove subscriber from session's subscriber list

        Ok(())
    }

    /// Remove a session entirely.
    pub fn remove_session(&mut self, session_id: &SessionId) -> Option<Session> {
        self.sessions.remove(session_id)
    }

    /// List all active session IDs.
    pub fn list_sessions(&self) -> Vec<SessionId> {
        self.sessions.keys().cloned().collect()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}
