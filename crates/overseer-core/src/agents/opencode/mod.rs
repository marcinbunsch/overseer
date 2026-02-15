//! OpenCode protocol parser.
//!
//! Parses OpenCode's HTTP API responses and converts to AgentEvents.
//!
//! # Protocol Overview
//!
//! OpenCode uses HTTP REST API, not stdout streaming:
//!
//! - **HTTP server**: Spawns `opencode serve` process on a port
//! - **SDK client**: Uses `@opencode-ai/sdk` for API calls
//! - **Synchronous**: `session/prompt` returns complete response
//! - **Permissive mode**: Uses `"*": "allow"` (no approval prompts)
//!
//! # API Flow
//!
//! ```text
//! 1. start_opencode_server → spawns `opencode serve` on port
//! 2. wait_for_server_ready → poll health endpoint
//! 3. session/create → create session with permissions
//! 4. session/prompt → send message, get full response
//! 5. parse response.parts → emit AgentEvents
//! 6. session/abort → interrupt if needed
//! ```
//!
//! # Response Structure
//!
//! The `session/prompt` response contains a `parts` array:
//!
//! ```json
//! {
//!   "parts": [
//!     {"type": "text", "text": "Hello"},
//!     {"type": "tool-invocation", "tool": {"name": "bash", "input": {...}}},
//!     {"type": "step-start"},
//!     {"type": "step-finish"}
//!   ]
//! }
//! ```
//!
//! # Example Usage
//!
//! ```ignore
//! use overseer_core::agents::opencode::OpenCodeParser;
//!
//! let parser = OpenCodeParser::new();
//!
//! // Parse response parts (from HTTP API)
//! let events = parser.parse_parts(&response.parts);
//!
//! // Emit events to UI
//! for event in events {
//!     handle_event(event);
//! }
//! ```

mod parser;
pub mod spawn;
mod types;

pub use parser::OpenCodeParser;
pub use spawn::OpenCodeConfig;
pub use types::*;
