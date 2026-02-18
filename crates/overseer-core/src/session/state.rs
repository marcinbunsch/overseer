//! Per-session state.

use crate::agents::turn::Turn;
use crate::approval::ApprovalContext;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for a session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A single agent session with process and state management.
pub struct Session {
    /// Unique session identifier
    pub id: SessionId,

    /// The current turn being processed (if any)
    pub current_turn: Option<Turn>,

    /// Approval context for this session (approved tools, prefixes)
    pub approval_context: ApprovalContext,

    /// Working directory for the session
    pub working_dir: String,

    /// Agent type (claude, codex, copilot, etc.)
    pub agent_type: String,
}

impl Session {
    pub fn new(id: SessionId, working_dir: String, agent_type: String) -> Self {
        Self {
            id,
            current_turn: None,
            approval_context: ApprovalContext::default(),
            working_dir,
            agent_type,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod session_id {
        use super::*;

        #[test]
        fn new_generates_unique_ids() {
            let id1 = SessionId::new();
            let id2 = SessionId::new();
            assert_ne!(id1, id2);
        }

        #[test]
        fn default_generates_unique_id() {
            let id1 = SessionId::default();
            let id2 = SessionId::default();
            assert_ne!(id1, id2);
        }

        #[test]
        fn display_shows_inner_string() {
            let id = SessionId("test-session-123".to_string());
            assert_eq!(format!("{}", id), "test-session-123");
        }

        #[test]
        fn equality() {
            let id1 = SessionId("same-id".to_string());
            let id2 = SessionId("same-id".to_string());
            let id3 = SessionId("different-id".to_string());

            assert_eq!(id1, id2);
            assert_ne!(id1, id3);
        }

        #[test]
        fn can_be_used_as_hashmap_key() {
            use std::collections::HashMap;
            let mut map = HashMap::new();
            let id = SessionId("test-id".to_string());
            map.insert(id.clone(), "value");
            assert_eq!(map.get(&id), Some(&"value"));
        }

        #[test]
        fn serialization_roundtrip() {
            let id = SessionId("test-session-456".to_string());
            let json = serde_json::to_string(&id).unwrap();
            let deserialized: SessionId = serde_json::from_str(&json).unwrap();
            assert_eq!(id, deserialized);
        }
    }

    mod session {
        use super::*;

        #[test]
        fn new_initializes_correctly() {
            let id = SessionId("test-session".to_string());
            let session = Session::new(
                id.clone(),
                "/home/user/project".to_string(),
                "claude".to_string(),
            );

            assert_eq!(session.id, id);
            assert_eq!(session.working_dir, "/home/user/project");
            assert_eq!(session.agent_type, "claude");
            assert!(session.current_turn.is_none());
        }

        #[test]
        fn approval_context_starts_empty() {
            let id = SessionId::new();
            let session = Session::new(id, "/tmp".to_string(), "codex".to_string());

            // ApprovalContext should start with no approved tools or prefixes
            assert!(!session
                .approval_context
                .should_auto_approve("WriteFile", &[]));
        }

        #[test]
        fn supports_different_agent_types() {
            let agent_types = vec!["claude", "codex", "copilot", "gemini", "opencode"];

            for agent_type in agent_types {
                let id = SessionId::new();
                let session = Session::new(id, "/tmp".to_string(), agent_type.to_string());
                assert_eq!(session.agent_type, agent_type);
            }
        }
    }
}
