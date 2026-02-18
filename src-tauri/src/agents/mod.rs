//! Agent process management modules.
//!
//! Each agent backend (Claude, Codex, Copilot, Gemini, OpenCode) has its own module that
//! exposes Tauri commands. All business logic lives in overseer-core's managers.
//!
//! These modules are thin wrappers that forward calls to the managers in OverseerContext.

pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod opencode;
