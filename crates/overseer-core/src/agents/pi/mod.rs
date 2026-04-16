//! Pi coding agent protocol parser.
//!
//! Parses Pi's RPC mode JSONL output and converts to AgentEvents.
//!
//! # Protocol Overview
//!
//! Pi uses a JSONL-based RPC protocol over stdin/stdout:
//!
//! - **Persistent process**: One `pi --mode rpc` process per chat
//! - **Commands on stdin**: `{"type": "prompt", "message": "..."}` etc.
//! - **Events on stdout**: Streaming events + command responses
//! - **No tool approvals**: Tools execute freely
//!
//! # Event Types (from pi-agent-core)
//!
//! - `agent_start` / `agent_end` — Agent lifecycle
//! - `turn_start` / `turn_end` — Turn lifecycle
//! - `message_start` / `message_update` / `message_end` — Assistant messages
//! - `tool_execution_start` / `tool_execution_update` / `tool_execution_end` — Tool calls
//! - `response` — Command acknowledgments
//! - Session-specific: `compaction_start/end`, `auto_retry_start/end`, `queue_update`

mod parser;
pub mod spawn;

pub use parser::PiParser;
pub use spawn::PiConfig;
