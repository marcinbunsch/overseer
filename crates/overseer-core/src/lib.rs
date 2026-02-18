//! # overseer-core
//!
//! Core business logic for Overseer, the AI coding agent frontend.
//!
//! This crate is framework-agnostic and can be used by:
//! - Tauri desktop app (via commands)
//! - SSH daemon (via JSON-RPC)
//! - Web server (via REST/WebSocket)
//!
//! ## Key Concepts
//!
//! - **Session**: An active agent conversation with process management
//! - **Turn**: A user message and the agent's complete response
//! - **AgentEvent**: Unified event type across all agent backends

pub mod agents;
pub mod approval;
pub mod git;
pub mod logging;
pub mod overseer_actions;
pub mod paths;
pub mod persistence;
pub mod session;
pub mod shell;
pub mod spawn;
pub mod usage;

// Re-export commonly used types
pub use agents::event::AgentEvent;
pub use approval::ApprovalContext;
pub use session::{Session, SessionId, SessionManager};
