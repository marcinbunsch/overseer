//! Claude protocol parser.
//!
//! Parses Claude's stream-json output format and converts to AgentEvents.

mod parser;
mod types;

pub use parser::ClaudeParser;
pub use types::*;
