//! Codex protocol parser.
//!
//! Parses Codex's JSON-RPC output format and converts to AgentEvents.

mod parser;
mod types;

pub use parser::CodexParser;
pub use types::*;
