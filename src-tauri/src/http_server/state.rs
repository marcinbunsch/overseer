//! Shared state for the HTTP server.
//!
//! This module provides [`HttpSharedState`], which wraps the [`OverseerContext`] and
//! optional authentication configuration for use by HTTP handlers.
//!
//! # Why a Wrapper?
//!
//! The HTTP server needs two things:
//! 1. Access to all Overseer functionality (agents, chats, PTY, etc.) via OverseerContext
//! 2. Optional authentication token for bearer auth
//!
//! Rather than passing these separately to every handler, we bundle them into HttpSharedState
//! which implements Clone (cheaply, via Arc) and can be passed to Axum's State extractor.
//!
//! # Thread Safety
//!
//! HttpSharedState is Clone + Send + Sync because:
//! - `context` is Arc<OverseerContext> (OverseerContext is Send + Sync)
//! - `auth_token` is Option<String> (immutable after creation)
//!
//! This allows HttpSharedState to be shared across all HTTP handler tasks.

use overseer_core::OverseerContext;
use std::path::PathBuf;
use std::sync::Arc;

/// Shared state available to all HTTP handlers.
///
/// This is the "application state" in Axum terms - passed to handlers via the `State` extractor.
/// It provides access to all Overseer functionality through [`OverseerContext`] and handles
/// authentication configuration.
///
/// # Contents
///
/// - **context**: The core Overseer context containing:
///   - EventBus for real-time event streaming
///   - ApprovalManager for command approval persistence
///   - ChatSessionManager for chat storage
///   - AgentManager for Claude/Codex/Copilot agents
///   - PtyManager for terminal sessions
///
/// - **auth_token**: Optional bearer token for authentication.
///   If Some, all requests must include `Authorization: Bearer <token>` header
///   (or `?token=<token>` query param for WebSocket).
///
/// # Example
///
/// ```ignore
/// // In a handler:
/// async fn my_handler(State(state): State<Arc<HttpSharedState>>) -> impl IntoResponse {
///     let result = state.context.agent_manager.list_running();
///     // ...
/// }
/// ```
#[derive(Clone)]
pub struct HttpSharedState {
    /// The core context containing all shared managers and state.
    /// Wrapped in Arc for cheap cloning across handler tasks.
    pub context: Arc<OverseerContext>,

    /// Optional authentication token for bearer auth.
    ///
    /// - `None`: Authentication disabled, all requests allowed
    /// - `Some(token)`: Requests must include this token to be authorized
    ///
    /// The token is typically generated randomly when the HTTP server starts
    /// and displayed in the UI for the user to copy.
    pub auth_token: Option<String>,
}

impl HttpSharedState {
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTORS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Create a shared state from an existing OverseerContext with optional auth.
    ///
    /// This is the primary constructor used when the HTTP server is started from
    /// the Tauri app, which already has an OverseerContext initialized.
    ///
    /// # Arguments
    ///
    /// * `context` - Reference to existing OverseerContext (will be Arc::cloned)
    /// * `auth_token` - Optional bearer token; if Some, all requests must authenticate
    pub fn from_context_with_auth(context: &Arc<OverseerContext>, auth_token: Option<String>) -> Self {
        Self {
            context: Arc::clone(context),
            auth_token,
        }
    }

    /// Create a shared state with the given context and no authentication.
    ///
    /// Useful for testing or development when auth is not needed.
    #[allow(dead_code)]
    pub fn new(context: Arc<OverseerContext>) -> Self {
        Self {
            context,
            auth_token: None,
        }
    }

    /// Create a new shared state with config directory for persistence.
    ///
    /// This creates a fresh OverseerContext and configures it to persist data
    /// in the specified directory. Useful for:
    /// - Testing with isolated config directories
    /// - Standalone HTTP server usage without Tauri
    ///
    /// # Arguments
    ///
    /// * `config_dir` - Directory for persisting chats, approvals, etc.
    #[allow(dead_code)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        let context = Arc::new(
            OverseerContext::builder()
                .config_dir(config_dir.clone())
                .build(),
        );

        // Configure managers with the config directory for persistence
        context.approval_manager.set_config_dir(config_dir.clone());
        context.chat_sessions.set_config_dir(config_dir);

        Self {
            context,
            auth_token: None,
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTHENTICATION
    // ═══════════════════════════════════════════════════════════════════════════

    /// Validate a bearer token against the configured auth token.
    ///
    /// # Returns
    ///
    /// - `true` if auth is disabled (auth_token is None)
    /// - `true` if auth is enabled and the provided token matches
    /// - `false` if auth is enabled and token is missing or wrong
    ///
    /// # Arguments
    ///
    /// * `token` - The token provided in the request (from header or query param)
    pub fn validate_token(&self, token: Option<&str>) -> bool {
        match &self.auth_token {
            None => true, // No auth configured = allow all
            Some(expected) => token == Some(expected.as_str()),
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATH HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Get the config directory (e.g., ~/.config/overseer).
    ///
    /// Returns None if no config directory was configured.
    pub fn get_config_dir(&self) -> Option<PathBuf> {
        self.context.config_dir()
    }

    /// Get the chat directory for a specific project/workspace combination.
    ///
    /// The path is typically: `{config_dir}/chats/{project_name}/{workspace_name}/`
    ///
    /// # Arguments
    ///
    /// * `project_name` - Name of the project (e.g., "overseer")
    /// * `workspace_name` - Name of the workspace (e.g., "zorilla")
    pub fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Option<PathBuf> {
        self.context.get_chat_dir(project_name, workspace_name)
    }
}
