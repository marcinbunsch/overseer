//! Core managers for Overseer state.
//!
//! These managers handle business logic and persistence without any
//! framework-specific dependencies. They can be used by:
//! - Tauri desktop app
//! - HTTP server
//! - SSH daemon (future)

pub mod approvals;
pub mod chat_session;
pub mod claude_agent;
pub mod codex_agent;
pub mod copilot_agent;
pub mod gemini_agent;
pub mod opencode_agent;
pub mod pty;

pub use approvals::ProjectApprovalManager;
pub use chat_session::ChatSessionManager;
pub use claude_agent::{ClaudeAgentManager, ClaudeStartConfig};
pub use codex_agent::{CodexAgentManager, CodexStartConfig};
pub use copilot_agent::{CopilotAgentManager, CopilotStartConfig};
pub use gemini_agent::{GeminiAgentManager, GeminiStartConfig};
pub use opencode_agent::{
    list_models_from_cli as opencode_list_models_cli, OpenCodeAgentManager, OpenCodeEvent,
    OpenCodeModel, OpenCodeServerInfo, OpenCodeStartConfig,
};
pub use pty::{PtyExit, PtyManager, PtySpawnConfig};
