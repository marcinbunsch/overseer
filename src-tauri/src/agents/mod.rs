//! Agent process management modules.
//!
//! Each agent backend (Claude, Codex, Copilot, Gemini) has its own module that handles
//! spawning, stdin/stdout communication, and lifecycle management.

pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod opencode;
mod shared;

// Re-export state types for .manage() calls
pub use claude::AgentProcessMap;
pub use codex::CodexServerMap;
pub use copilot::CopilotServerMap;
pub use gemini::GeminiServerMap;
pub use opencode::OpenCodeServerMap;
pub use shared::build_login_shell_command;
#[cfg(test)]
pub(crate) use shared::AgentExit;
