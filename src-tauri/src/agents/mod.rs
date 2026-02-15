//! Agent process management modules.
//!
//! Each agent backend (Claude, Codex, Copilot, Gemini) has its own module that handles
//! spawning, stdin/stdout communication, and lifecycle management.
//!
//! Agent-specific configuration and process spawning logic lives in `overseer_core::spawn`.
//! These modules are thin wrappers that forward events to Tauri.

pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod opencode;

// Re-export state types for .manage() calls
pub use claude::AgentProcessMap;
pub use codex::CodexServerMap;
pub use copilot::CopilotServerMap;
pub use gemini::GeminiServerMap;
pub use opencode::OpenCodeServerMap;
