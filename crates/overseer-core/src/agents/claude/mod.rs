//! Claude protocol parser and spawn configuration.
//!
//! Parses Claude's stream-json output format and converts to AgentEvents.

mod parser;
pub mod spawn;
mod types;

pub use parser::ClaudeParser;
pub use spawn::ClaudeConfig;
pub use types::*;
