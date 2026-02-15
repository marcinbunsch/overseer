//! Gemini protocol parser.
//!
//! Parses Gemini CLI's NDJSON streaming output and converts to AgentEvents.
//!
//! # Protocol Overview
//!
//! Gemini uses simple NDJSON (Newline-Delimited JSON), not JSON-RPC:
//!
//! - Each line is a self-contained event with a `type` field
//! - No request/response correlation (unlike JSON-RPC)
//! - No interactive tool approvals (uses `--approval-mode`)
//! - One-shot model: new process per message, session continuity via `--resume`
//!
//! # Event Types
//!
//! - `init` — Session start, provides session_id for resumption
//! - `message` — Text content (streaming delta or complete)
//! - `tool_use` — Tool invocation with parameters
//! - `tool_result` — Tool output (success or error)
//! - `error` — Error message
//! - `result` — Final event with session stats
//!
//! # Example Usage
//!
//! ```ignore
//! use overseer_core::agents::gemini::GeminiParser;
//!
//! let mut parser = GeminiParser::new();
//!
//! // Feed data from the process
//! let events = parser.feed(&data);
//!
//! // Process events
//! for event in events {
//!     handle_event(event);
//! }
//!
//! // When process exits, flush remaining buffer and emit TurnComplete
//! let final_events = parser.flush();
//! emit(AgentEvent::TurnComplete);
//! ```

mod parser;
mod types;

pub use parser::GeminiParser;
pub use types::*;
