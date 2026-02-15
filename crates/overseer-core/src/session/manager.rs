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
#[derive(Debug)]
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

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> SessionConfig {
        SessionConfig {
            working_dir: "/home/user/project".to_string(),
            agent_type: "claude".to_string(),
            model: Some("claude-sonnet-4-20250514".to_string()),
        }
    }

    mod session_manager {
        use super::*;

        #[test]
        fn new_creates_empty_manager() {
            let manager = SessionManager::new();
            assert!(manager.list_sessions().is_empty());
        }

        #[test]
        fn default_creates_empty_manager() {
            let manager = SessionManager::default();
            assert!(manager.list_sessions().is_empty());
        }

        #[test]
        fn create_session_returns_unique_ids() {
            let mut manager = SessionManager::new();
            let config = create_test_config();

            let id1 = manager.create_session(config.clone());
            let id2 = manager.create_session(config.clone());
            let id3 = manager.create_session(config);

            assert_ne!(id1, id2);
            assert_ne!(id2, id3);
            assert_ne!(id1, id3);
        }

        #[test]
        fn create_session_adds_to_manager() {
            let mut manager = SessionManager::new();
            let config = create_test_config();

            assert_eq!(manager.list_sessions().len(), 0);
            manager.create_session(config.clone());
            assert_eq!(manager.list_sessions().len(), 1);
            manager.create_session(config);
            assert_eq!(manager.list_sessions().len(), 2);
        }

        #[test]
        fn get_session_returns_existing() {
            let mut manager = SessionManager::new();
            let config = create_test_config();
            let id = manager.create_session(config);

            let session = manager.get_session(&id);
            assert!(session.is_some());
            assert_eq!(session.unwrap().id, id);
        }

        #[test]
        fn get_session_returns_none_for_nonexistent() {
            let manager = SessionManager::new();
            let fake_id = SessionId("nonexistent".to_string());

            assert!(manager.get_session(&fake_id).is_none());
        }

        #[test]
        fn get_session_mut_allows_modification() {
            let mut manager = SessionManager::new();
            let config = create_test_config();
            let id = manager.create_session(config);

            // Modify the session
            {
                let session = manager.get_session_mut(&id).unwrap();
                session.working_dir = "/new/path".to_string();
            }

            // Verify modification persisted
            let session = manager.get_session(&id).unwrap();
            assert_eq!(session.working_dir, "/new/path");
        }

        #[test]
        fn remove_session_removes_existing() {
            let mut manager = SessionManager::new();
            let config = create_test_config();
            let id = manager.create_session(config);

            assert!(manager.get_session(&id).is_some());
            let removed = manager.remove_session(&id);
            assert!(removed.is_some());
            assert!(manager.get_session(&id).is_none());
        }

        #[test]
        fn remove_session_returns_none_for_nonexistent() {
            let mut manager = SessionManager::new();
            let fake_id = SessionId("nonexistent".to_string());

            let removed = manager.remove_session(&fake_id);
            assert!(removed.is_none());
        }

        #[test]
        fn list_sessions_returns_all_ids() {
            let mut manager = SessionManager::new();
            let config = create_test_config();

            let id1 = manager.create_session(config.clone());
            let id2 = manager.create_session(config.clone());
            let id3 = manager.create_session(config);

            let sessions = manager.list_sessions();
            assert_eq!(sessions.len(), 3);
            assert!(sessions.contains(&id1));
            assert!(sessions.contains(&id2));
            assert!(sessions.contains(&id3));
        }
    }

    mod attach_detach {
        use super::*;

        #[test]
        fn attach_succeeds_for_existing_session() {
            let mut manager = SessionManager::new();
            let config = create_test_config();
            let session_id = manager.create_session(config);
            let subscriber_id = SubscriberId("subscriber-1".to_string());

            let result = manager.attach(session_id.clone(), subscriber_id.clone());
            assert!(result.is_ok());

            let handle = result.unwrap();
            assert_eq!(handle.session_id, session_id);
            assert_eq!(handle.subscriber_id, subscriber_id);
        }

        #[test]
        fn attach_fails_for_nonexistent_session() {
            let mut manager = SessionManager::new();
            let fake_id = SessionId("nonexistent".to_string());
            let subscriber_id = SubscriberId("subscriber-1".to_string());

            let result = manager.attach(fake_id.clone(), subscriber_id);
            assert!(result.is_err());

            match result.unwrap_err() {
                SessionError::NotFound(id) => assert_eq!(id, fake_id),
                _ => panic!("Expected NotFound error"),
            }
        }

        #[test]
        fn detach_succeeds_for_existing_session() {
            let mut manager = SessionManager::new();
            let config = create_test_config();
            let session_id = manager.create_session(config);
            let subscriber_id = SubscriberId("subscriber-1".to_string());

            let result = manager.detach(&session_id, &subscriber_id);
            assert!(result.is_ok());
        }

        #[test]
        fn detach_fails_for_nonexistent_session() {
            let mut manager = SessionManager::new();
            let fake_id = SessionId("nonexistent".to_string());
            let subscriber_id = SubscriberId("subscriber-1".to_string());

            let result = manager.detach(&fake_id, &subscriber_id);
            assert!(result.is_err());

            match result.unwrap_err() {
                SessionError::NotFound(id) => assert_eq!(id, fake_id),
                _ => panic!("Expected NotFound error"),
            }
        }
    }

    mod session_error {
        use super::*;

        #[test]
        fn not_found_displays_session_id() {
            let id = SessionId("test-123".to_string());
            let error = SessionError::NotFound(id);
            assert!(error.to_string().contains("test-123"));
        }

        #[test]
        fn already_exists_displays_session_id() {
            let id = SessionId("existing-456".to_string());
            let error = SessionError::AlreadyExists(id);
            assert!(error.to_string().contains("existing-456"));
        }

        #[test]
        fn spawn_failed_displays_message() {
            let error = SessionError::SpawnFailed("Could not find claude binary".to_string());
            assert!(error.to_string().contains("Could not find claude binary"));
        }
    }

    mod subscriber_id {
        use super::*;

        #[test]
        fn equality() {
            let id1 = SubscriberId("sub-1".to_string());
            let id2 = SubscriberId("sub-1".to_string());
            let id3 = SubscriberId("sub-2".to_string());

            assert_eq!(id1, id2);
            assert_ne!(id1, id3);
        }

        #[test]
        fn can_be_used_as_hashmap_key() {
            use std::collections::HashSet;
            let mut set = HashSet::new();
            let id = SubscriberId("subscriber".to_string());
            set.insert(id.clone());
            assert!(set.contains(&id));
        }
    }

    mod session_config {
        use super::*;

        #[test]
        fn clone_works() {
            let config = SessionConfig {
                working_dir: "/path".to_string(),
                agent_type: "claude".to_string(),
                model: Some("gpt-4".to_string()),
            };

            let cloned = config.clone();
            assert_eq!(config.working_dir, cloned.working_dir);
            assert_eq!(config.agent_type, cloned.agent_type);
            assert_eq!(config.model, cloned.model);
        }

        #[test]
        fn model_can_be_none() {
            let config = SessionConfig {
                working_dir: "/path".to_string(),
                agent_type: "codex".to_string(),
                model: None,
            };
            assert!(config.model.is_none());
        }
    }
}
