//! Shared state for the HTTP server.
//!
//! Wraps the EventBus and all other state needed by HTTP handlers.
//! This state is shared between Tauri commands and HTTP handlers.

use overseer_core::event_bus::EventBus;
use std::path::PathBuf;
use std::sync::Arc;

use crate::agents::{
    AgentProcessMap, CodexServerMap, CopilotServerMap, GeminiServerMap, OpenCodeServerMap,
};
use crate::approvals::ProjectApprovalManager;
use crate::chat_session::ChatSessionManager;
use crate::pty::PtyMap;

/// Shared state available to all HTTP handlers.
///
/// This consolidates all managed state from Tauri into a single structure
/// that can be passed to HTTP handlers.
///
/// Note: Agent/PTY maps are included here for future use when agent
/// start/stop commands are implemented over HTTP. Currently these
/// commands return NOT_IMPLEMENTED as they require native process management.
#[derive(Clone)]
pub struct SharedState {
    /// The event bus for publishing/subscribing to events.
    pub event_bus: Arc<EventBus>,
    /// The config directory for persistence operations.
    config_dir: Option<PathBuf>,
    /// Agent process map (Claude).
    pub agent_processes: Arc<AgentProcessMap>,
    /// Codex server map.
    pub codex_servers: Arc<CodexServerMap>,
    /// Copilot server map.
    pub copilot_servers: Arc<CopilotServerMap>,
    /// Gemini server map.
    pub gemini_servers: Arc<GeminiServerMap>,
    /// OpenCode server map.
    pub opencode_servers: Arc<OpenCodeServerMap>,
    /// Project approval manager.
    pub approval_manager: Arc<ProjectApprovalManager>,
    /// Chat session manager.
    pub chat_sessions: Arc<ChatSessionManager>,
    /// PTY map for terminal sessions.
    pub pty_map: Arc<PtyMap>,
}

impl SharedState {
    /// Create a new shared state with the given event bus.
    ///
    /// Note: This constructor is useful for testing or standalone HTTP server usage.
    #[allow(dead_code)]
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self {
            event_bus,
            config_dir: None,
            agent_processes: Arc::new(AgentProcessMap::default()),
            codex_servers: Arc::new(CodexServerMap::default()),
            copilot_servers: Arc::new(CopilotServerMap::default()),
            gemini_servers: Arc::new(GeminiServerMap::default()),
            opencode_servers: Arc::new(OpenCodeServerMap::default()),
            approval_manager: Arc::new(ProjectApprovalManager::default()),
            chat_sessions: Arc::new(ChatSessionManager::default()),
            pty_map: Arc::new(PtyMap::default()),
        }
    }

    /// Create a new shared state with config directory.
    ///
    /// Note: This constructor is useful for testing or standalone HTTP server usage
    /// with persistence support.
    #[allow(dead_code)]
    pub fn with_config_dir(event_bus: Arc<EventBus>, config_dir: PathBuf) -> Self {
        let approval_manager = Arc::new(ProjectApprovalManager::default());
        approval_manager.set_config_dir(config_dir.clone());

        let chat_sessions = Arc::new(ChatSessionManager::default());
        chat_sessions.set_config_dir(config_dir.clone());

        Self {
            event_bus,
            config_dir: Some(config_dir),
            agent_processes: Arc::new(AgentProcessMap::default()),
            codex_servers: Arc::new(CodexServerMap::default()),
            copilot_servers: Arc::new(CopilotServerMap::default()),
            gemini_servers: Arc::new(GeminiServerMap::default()),
            opencode_servers: Arc::new(OpenCodeServerMap::default()),
            approval_manager,
            chat_sessions,
            pty_map: Arc::new(PtyMap::default()),
        }
    }

    /// Create a shared state with all state hoisted from Tauri.
    pub fn with_all_state(
        event_bus: Arc<EventBus>,
        config_dir: Option<PathBuf>,
        agent_processes: Arc<AgentProcessMap>,
        codex_servers: Arc<CodexServerMap>,
        copilot_servers: Arc<CopilotServerMap>,
        gemini_servers: Arc<GeminiServerMap>,
        opencode_servers: Arc<OpenCodeServerMap>,
        approval_manager: Arc<ProjectApprovalManager>,
        chat_sessions: Arc<ChatSessionManager>,
        pty_map: Arc<PtyMap>,
    ) -> Self {
        Self {
            event_bus,
            config_dir,
            agent_processes,
            codex_servers,
            copilot_servers,
            gemini_servers,
            opencode_servers,
            approval_manager,
            chat_sessions,
            pty_map,
        }
    }

    /// Get the config directory.
    pub fn get_config_dir(&self) -> Option<PathBuf> {
        self.config_dir.clone()
    }

    /// Get the chats directory for a project/workspace.
    pub fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Option<PathBuf> {
        self.config_dir.as_ref().map(|dir| {
            dir.join("chats")
                .join(project_name)
                .join(workspace_name)
        })
    }
}
