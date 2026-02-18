//! Codex protocol parser and spawn configuration.
//!
//! Parses Codex's JSON-RPC output format and converts to AgentEvents.

mod parser;
pub mod spawn;
mod types;

pub use parser::CodexParser;
pub use spawn::CodexConfig;
pub use types::*;
