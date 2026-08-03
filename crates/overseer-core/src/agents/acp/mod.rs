//! Shared ACP (Agent Client Protocol) parser and JSON types.
//!
//! ACP is a JSON-RPC 2.0 protocol over stdio used by multiple agent CLIs
//! (Copilot via `copilot --acp --stdio`, Hermes via `hermes acp`). The wire
//! format is identical across agents, so the parser lives here and each
//! agent module keeps only its spawn configuration.
//!
//! # Protocol Overview
//!
//! - Session updates via `session/update` notifications with nested `sessionUpdate` types
//! - Permission requests via `session/request_permission` server requests
//! - Tool calls tracked via `tool_call` and `tool_call_update` session updates
//! - Support for Task/subagent spawning with `parent_tool_use_id` grouping
//!
//! # Example Usage
//!
//! ```ignore
//! use overseer_core::agents::acp::AcpParser;
//!
//! let mut parser = AcpParser::new();
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
mod types;

pub use parser::{AcpParser, ServerRequestPending};
pub use types::*;
