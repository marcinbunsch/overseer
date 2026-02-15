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
