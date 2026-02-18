//! Shared state for the HTTP server.
//!
//! Wraps the EventBus and any other state needed by HTTP handlers.

use overseer_core::event_bus::EventBus;
use std::path::PathBuf;
use std::sync::Arc;

/// Shared state available to all HTTP handlers.
#[derive(Clone)]
pub struct SharedState {
    /// The event bus for publishing/subscribing to events.
    pub event_bus: Arc<EventBus>,
    /// The config directory for persistence operations.
    config_dir: Option<PathBuf>,
}

impl SharedState {
    /// Create a new shared state with the given event bus.
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self {
            event_bus,
            config_dir: None,
        }
    }

    /// Create a new shared state with config directory.
    pub fn with_config_dir(event_bus: Arc<EventBus>, config_dir: PathBuf) -> Self {
        Self {
            event_bus,
            config_dir: Some(config_dir),
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
