//! OverseerContext - The central shared state for all Overseer operations.
//!
//! This module provides the `OverseerContext` struct which holds all shared state
//! that both Tauri and HTTP interfaces need to operate. By centralizing state here,
//! we ensure that:
//!
//! 1. Both interfaces work with the same data
//! 2. State management logic lives in overseer-core (framework-agnostic)
//! 3. Interfaces are thin wrappers that just forward calls
//!
//! ## Architecture
//!
//! ```text
//!                    ┌─────────────────────────┐
//!                    │     OverseerContext     │
//!                    │  (lives in overseer-core)│
//!                    ├─────────────────────────┤
//!                    │  - EventBus             │
//!                    │  - ApprovalManager      │
//!                    │  - ChatSessionManager   │
//!                    │  - config_dir           │
//!                    └───────────┬─────────────┘
//!                                │
//!            ┌───────────────────┼───────────────────┐
//!            │                   │                   │
//!            ▼                   ▼                   ▼
//!     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
//!     │  Tauri App  │     │ HTTP Server │     │  SSH Daemon │
//!     │  (commands) │     │   (routes)  │     │   (future)  │
//!     └─────────────┘     └─────────────┘     └─────────────┘
//! ```

use crate::event_bus::EventBus;
use crate::managers::{
    ChatSessionManager, ClaudeAgentManager, CodexAgentManager, CopilotAgentManager,
    GeminiAgentManager, OpenCodeAgentManager, ProjectApprovalManager, PtyManager,
};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// Configuration for building an OverseerContext.
#[derive(Default)]
pub struct OverseerContextBuilder {
    config_dir: Option<PathBuf>,
    event_bus: Option<Arc<EventBus>>,
    approval_manager: Option<Arc<ProjectApprovalManager>>,
    chat_sessions: Option<Arc<ChatSessionManager>>,
    claude_agents: Option<Arc<ClaudeAgentManager>>,
    codex_agents: Option<Arc<CodexAgentManager>>,
    copilot_agents: Option<Arc<CopilotAgentManager>>,
    gemini_agents: Option<Arc<GeminiAgentManager>>,
    opencode_agents: Option<Arc<OpenCodeAgentManager>>,
    pty_manager: Option<Arc<PtyManager>>,
}

impl OverseerContextBuilder {
    /// Create a new builder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the configuration directory.
    pub fn config_dir(mut self, dir: PathBuf) -> Self {
        self.config_dir = Some(dir);
        self
    }

    /// Use an existing EventBus (for testing or custom configurations).
    pub fn event_bus(mut self, bus: Arc<EventBus>) -> Self {
        self.event_bus = Some(bus);
        self
    }

    /// Use an existing ProjectApprovalManager (for testing or custom configurations).
    pub fn approval_manager(mut self, manager: Arc<ProjectApprovalManager>) -> Self {
        self.approval_manager = Some(manager);
        self
    }

    /// Use an existing ChatSessionManager (for testing or custom configurations).
    pub fn chat_sessions(mut self, manager: Arc<ChatSessionManager>) -> Self {
        self.chat_sessions = Some(manager);
        self
    }

    /// Use an existing ClaudeAgentManager (for testing or custom configurations).
    pub fn claude_agents(mut self, manager: Arc<ClaudeAgentManager>) -> Self {
        self.claude_agents = Some(manager);
        self
    }

    /// Use an existing CodexAgentManager (for testing or custom configurations).
    pub fn codex_agents(mut self, manager: Arc<CodexAgentManager>) -> Self {
        self.codex_agents = Some(manager);
        self
    }

    /// Use an existing CopilotAgentManager (for testing or custom configurations).
    pub fn copilot_agents(mut self, manager: Arc<CopilotAgentManager>) -> Self {
        self.copilot_agents = Some(manager);
        self
    }

    /// Use an existing GeminiAgentManager (for testing or custom configurations).
    pub fn gemini_agents(mut self, manager: Arc<GeminiAgentManager>) -> Self {
        self.gemini_agents = Some(manager);
        self
    }

    /// Use an existing OpenCodeAgentManager (for testing or custom configurations).
    pub fn opencode_agents(mut self, manager: Arc<OpenCodeAgentManager>) -> Self {
        self.opencode_agents = Some(manager);
        self
    }

    /// Use an existing PtyManager (for testing or custom configurations).
    pub fn pty_manager(mut self, manager: Arc<PtyManager>) -> Self {
        self.pty_manager = Some(manager);
        self
    }

    /// Build the OverseerContext.
    pub fn build(self) -> OverseerContext {
        let event_bus = self.event_bus.unwrap_or_else(|| Arc::new(EventBus::new()));
        let approval_manager = self
            .approval_manager
            .unwrap_or_else(|| Arc::new(ProjectApprovalManager::new()));
        let chat_sessions = self
            .chat_sessions
            .unwrap_or_else(|| Arc::new(ChatSessionManager::new()));
        let claude_agents = self
            .claude_agents
            .unwrap_or_else(|| Arc::new(ClaudeAgentManager::new()));
        let codex_agents = self
            .codex_agents
            .unwrap_or_else(|| Arc::new(CodexAgentManager::new()));
        let copilot_agents = self
            .copilot_agents
            .unwrap_or_else(|| Arc::new(CopilotAgentManager::new()));
        let gemini_agents = self
            .gemini_agents
            .unwrap_or_else(|| Arc::new(GeminiAgentManager::new()));
        let opencode_agents = self
            .opencode_agents
            .unwrap_or_else(|| Arc::new(OpenCodeAgentManager::new()));
        let pty_manager = self
            .pty_manager
            .unwrap_or_else(|| Arc::new(PtyManager::new()));

        OverseerContext {
            event_bus,
            config_dir: Arc::new(RwLock::new(self.config_dir)),
            approval_manager,
            chat_sessions,
            claude_agents,
            codex_agents,
            copilot_agents,
            gemini_agents,
            opencode_agents,
            pty_manager,
        }
    }
}

/// Central shared state for all Overseer operations.
///
/// This struct holds all the managers and state that needs to be shared
/// between different interfaces (Tauri, HTTP, future SSH daemon).
///
/// All fields use `Arc` for cheap cloning - cloning the context just
/// clones the pointers, not the underlying data.
#[derive(Clone)]
pub struct OverseerContext {
    /// The event bus for publishing/subscribing to events.
    pub event_bus: Arc<EventBus>,
    /// The configuration directory for persistence.
    /// Uses RwLock because it may be set after construction (e.g., in Tauri setup).
    config_dir: Arc<RwLock<Option<PathBuf>>>,
    /// Project approval manager for auto-approval decisions.
    pub approval_manager: Arc<ProjectApprovalManager>,
    /// Chat session manager for persistence.
    pub chat_sessions: Arc<ChatSessionManager>,
    /// Claude agent manager.
    pub claude_agents: Arc<ClaudeAgentManager>,
    /// Codex agent manager.
    pub codex_agents: Arc<CodexAgentManager>,
    /// Copilot agent manager.
    pub copilot_agents: Arc<CopilotAgentManager>,
    /// Gemini agent manager.
    pub gemini_agents: Arc<GeminiAgentManager>,
    /// OpenCode agent manager.
    pub opencode_agents: Arc<OpenCodeAgentManager>,
    /// PTY manager.
    pub pty_manager: Arc<PtyManager>,
}

impl OverseerContext {
    /// Create a new OverseerContext with a builder.
    pub fn builder() -> OverseerContextBuilder {
        OverseerContextBuilder::new()
    }

    /// Get the configuration directory.
    pub fn config_dir(&self) -> Option<PathBuf> {
        self.config_dir.read().unwrap().clone()
    }

    /// Set the configuration directory.
    ///
    /// This is useful when the config directory is determined after context creation
    /// (e.g., in Tauri's setup phase).
    pub fn set_config_dir(&self, dir: PathBuf) {
        *self.config_dir.write().unwrap() = Some(dir);
    }

    /// Get the chats directory for a project/workspace.
    pub fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Option<PathBuf> {
        self.config_dir.read().unwrap().as_ref().map(|dir| {
            dir.join("chats")
                .join(project_name)
                .join(workspace_name)
        })
    }

    /// Get the project directory for approvals.
    pub fn get_project_dir(&self, project_name: &str) -> Option<PathBuf> {
        self.config_dir
            .read()
            .unwrap()
            .as_ref()
            .map(|dir| dir.join("chats").join(project_name))
    }
}

impl Default for OverseerContext {
    fn default() -> Self {
        Self::builder().build()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_creates_context_with_defaults() {
        let ctx = OverseerContext::builder().build();
        assert!(ctx.config_dir().is_none());
    }

    #[test]
    fn builder_sets_config_dir() {
        let ctx = OverseerContext::builder()
            .config_dir(PathBuf::from("/test/config"))
            .build();
        assert_eq!(ctx.config_dir(), Some(PathBuf::from("/test/config")));
    }

    #[test]
    fn set_config_dir_after_construction() {
        let ctx = OverseerContext::builder().build();
        assert!(ctx.config_dir().is_none());

        ctx.set_config_dir(PathBuf::from("/late/config"));
        assert_eq!(ctx.config_dir(), Some(PathBuf::from("/late/config")));
    }

    #[test]
    fn builder_uses_provided_event_bus() {
        let bus = Arc::new(EventBus::new());
        let bus_clone = Arc::clone(&bus);
        let ctx = OverseerContext::builder().event_bus(bus).build();

        // Both should point to the same EventBus
        assert!(Arc::ptr_eq(&ctx.event_bus, &bus_clone));
    }

    #[test]
    fn get_chat_dir_returns_correct_path() {
        let ctx = OverseerContext::builder()
            .config_dir(PathBuf::from("/config"))
            .build();

        let chat_dir = ctx.get_chat_dir("my-project", "feature-branch");
        assert_eq!(
            chat_dir,
            Some(PathBuf::from("/config/chats/my-project/feature-branch"))
        );
    }

    #[test]
    fn get_chat_dir_returns_none_without_config() {
        let ctx = OverseerContext::builder().build();
        assert!(ctx.get_chat_dir("project", "workspace").is_none());
    }

    #[test]
    fn context_is_cheaply_clonable() {
        let ctx = OverseerContext::builder()
            .config_dir(PathBuf::from("/config"))
            .build();

        let ctx2 = ctx.clone();

        // Both should share the same EventBus
        assert!(Arc::ptr_eq(&ctx.event_bus, &ctx2.event_bus));
    }
}
