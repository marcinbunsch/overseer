//! Shared state for the HTTP server.
//!
//! Wraps the OverseerContext which contains all shared state.

use overseer_core::OverseerContext;
use std::path::PathBuf;
use std::sync::Arc;

/// Shared state available to all HTTP handlers.
///
/// This is a thin wrapper around OverseerContext which now contains all
/// shared managers (EventBus, ApprovalManager, ChatSessionManager, agent managers, PTY manager).
#[derive(Clone)]
pub struct SharedState {
    /// The core context containing all shared state.
    pub context: Arc<OverseerContext>,
    /// Optional authentication token for bearer auth.
    /// If set, all API and WebSocket requests must include this token.
    pub auth_token: Option<String>,
}

impl SharedState {
    /// Create a shared state from an OverseerContext with an optional auth token.
    pub fn from_context_with_auth(context: &Arc<OverseerContext>, auth_token: Option<String>) -> Self {
        Self {
            context: Arc::clone(context),
            auth_token,
        }
    }

    /// Create a new shared state with the given context.
    #[allow(dead_code)]
    pub fn new(context: Arc<OverseerContext>) -> Self {
        Self {
            context,
            auth_token: None,
        }
    }

    /// Create a new shared state with config directory.
    ///
    /// Note: This constructor is useful for testing or standalone HTTP server usage
    /// with persistence support.
    #[allow(dead_code)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let context = Arc::new(
            OverseerContext::builder()
                .config_dir(config_dir.clone())
                .build(),
        );

        // Set config dir on managers from context
        context.approval_manager.set_config_dir(config_dir.clone());
        context.chat_sessions.set_config_dir(config_dir);

        Self {
            context,
            auth_token: None,
        }
    }

    /// Check if a given token is valid.
    /// Returns true if no auth is configured or if the token matches.
    pub fn validate_token(&self, token: Option<&str>) -> bool {
        match &self.auth_token {
            None => true, // No auth configured, allow all
            Some(expected) => token == Some(expected.as_str()),
        }
    }

    /// Get the config directory.
    pub fn get_config_dir(&self) -> Option<PathBuf> {
        self.context.config_dir()
    }

    /// Get the chats directory for a project/workspace.
    pub fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Option<PathBuf> {
        self.context.get_chat_dir(project_name, workspace_name)
    }
}
