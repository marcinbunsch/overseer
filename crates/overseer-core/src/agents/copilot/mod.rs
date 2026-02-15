//! Copilot protocol parser and spawn configuration.
//!
//! Parses Copilot's ACP (Agent Communication Protocol) output format and converts to AgentEvents.
//!
//! # Protocol Overview
//!
//! Copilot uses JSON-RPC 2.0 with the ACP extension. Key differences from Codex:
//!
//! - Session updates via `session/update` notifications with nested `sessionUpdate` types
//! - Permission requests via `session/request_permission` server requests
//! - Tool calls tracked via `tool_call` and `tool_call_update` session updates
//! - Support for Task/subagent spawning with `parent_tool_use_id` grouping
//!
//! # Example Usage
//!
//! ```ignore
//! use overseer_core::agents::copilot::CopilotParser;
//!
//! let mut parser = CopilotParser::new();
//!
//! // Feed data from the process
//! let (events, pending_requests) = parser.feed(&data);
//!
//! // Process events
//! for event in events {
//!     handle_event(event);
//! }
//!
//! // Respond to pending requests (permission prompts)
//! for pending in pending_requests {
//!     send_response(pending.id, approved);
//! }
//! ```

mod parser;
pub mod spawn;
mod types;

pub use parser::{CopilotParser, ServerRequestPending};
pub use spawn::CopilotConfig;
pub use types::*;
