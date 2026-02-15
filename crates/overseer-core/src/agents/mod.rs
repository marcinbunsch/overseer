//! Agent protocol handling and process management.
//!
//! Each agent type (Claude, Codex, Copilot, etc.) has its own submodule
//! for protocol parsing, but they all emit the same `AgentEvent` type.

pub mod event;
pub mod turn;

// Agent-specific parsers (to be implemented)
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod opencode;

pub use event::AgentEvent;
pub use turn::{Decision, EventResolution, Turn, TurnEvent, TurnId, TurnStatus};
