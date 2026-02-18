//! OpenCode-specific types for HTTP API response parsing.
//!
//! # OpenCode Protocol Overview
//!
//! OpenCode is fundamentally different from other agents:
//!
//! - **HTTP-based**: Uses REST API, not stdout streaming
//! - **Synchronous**: Waits for complete response (no real-time streaming)
//! - **SDK-based**: TypeScript uses `@opencode-ai/sdk` for communication
//! - **Permissive mode**: Uses `"*": "allow"` permissions (no approval prompts)
//!
//! # Architecture
//!
//! ```text
//! Overseer → start_opencode_server (spawns `opencode serve`)
//!         → HTTP API calls via SDK:
//!           - session/create
//!           - session/prompt (returns full response)
//!         → Parse response parts into AgentEvents
//! ```
//!
//! # Response Structure
//!
//! The `session/prompt` endpoint returns:
//! ```json
//! {
//!   "parts": [
//!     {"type": "text", "text": "Hello"},
//!     {"type": "tool-invocation", "tool": {"name": "bash", "input": {...}, "output": {...}}},
//!     {"type": "step-start", ...},
//!     {"type": "step-finish", ...}
//!   ]
//! }
//! ```

use serde::Deserialize;

/// A response part from OpenCode's session/prompt endpoint.
///
/// Parts represent different elements of the agent's response:
/// - Text blocks
/// - Tool invocations (with input and output)
/// - Step lifecycle events
#[derive(Debug, Clone, Deserialize)]
pub struct OpenCodePart {
    /// Part ID.
    #[serde(default)]
    pub id: Option<String>,

    /// Session ID this part belongs to.
    #[serde(rename = "sessionID")]
    #[serde(default)]
    pub session_id: Option<String>,

    /// Message ID this part belongs to.
    #[serde(rename = "messageID")]
    #[serde(default)]
    pub message_id: Option<String>,

    /// The part type: "text", "tool-invocation", "step-start", "step-finish".
    #[serde(rename = "type")]
    pub part_type: String,

    /// Text content (for "text" parts).
    #[serde(default)]
    pub text: Option<String>,

    /// Tool information (for "tool-invocation" parts).
    #[serde(default)]
    pub tool: Option<ToolInfo>,

    /// Timing information.
    #[serde(default)]
    pub time: Option<TimeInfo>,
}

/// Tool information in a tool-invocation part.
#[derive(Debug, Clone, Deserialize)]
pub struct ToolInfo {
    /// Tool name: "bash", "write", "edit", "read", etc.
    pub name: String,

    /// Tool input (command, file path, etc.).
    #[serde(default)]
    pub input: Option<serde_json::Value>,

    /// Tool output (result or error).
    #[serde(default)]
    pub output: Option<serde_json::Value>,
}

/// Timing information for parts.
#[derive(Debug, Clone, Deserialize)]
pub struct TimeInfo {
    /// Start timestamp (Unix ms).
    #[serde(default)]
    pub start: Option<u64>,

    /// End timestamp (Unix ms).
    #[serde(default)]
    pub end: Option<u64>,
}

/// Model information from OpenCode.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenCodeModel {
    /// Model ID (e.g., "anthropic/claude-sonnet-4-5").
    pub id: String,

    /// Human-readable name.
    pub name: String,

    /// Provider ID (e.g., "anthropic").
    pub provider_id: String,
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_text_part() {
        let json = r#"{"type":"text","text":"Hello, world!","id":"part-1","sessionID":"sess-1"}"#;
        let part: OpenCodePart = serde_json::from_str(json).unwrap();
        assert_eq!(part.part_type, "text");
        assert_eq!(part.text, Some("Hello, world!".to_string()));
    }

    #[test]
    fn parse_tool_invocation_part() {
        let json = r#"{"type":"tool-invocation","tool":{"name":"bash","input":{"command":"ls"},"output":"file.txt"}}"#;
        let part: OpenCodePart = serde_json::from_str(json).unwrap();
        assert_eq!(part.part_type, "tool-invocation");
        assert!(part.tool.is_some());
        let tool = part.tool.unwrap();
        assert_eq!(tool.name, "bash");
    }

    #[test]
    fn parse_step_start_part() {
        let json = r#"{"type":"step-start","id":"step-1"}"#;
        let part: OpenCodePart = serde_json::from_str(json).unwrap();
        assert_eq!(part.part_type, "step-start");
    }

    #[test]
    fn parse_step_finish_part() {
        let json = r#"{"type":"step-finish","id":"step-1","time":{"start":1000,"end":2000}}"#;
        let part: OpenCodePart = serde_json::from_str(json).unwrap();
        assert_eq!(part.part_type, "step-finish");
        assert!(part.time.is_some());
        let time = part.time.unwrap();
        assert_eq!(time.start, Some(1000));
        assert_eq!(time.end, Some(2000));
    }

    #[test]
    fn parse_tool_info() {
        let json =
            r#"{"name":"write","input":{"path":"test.txt","content":"hello"},"output":null}"#;
        let tool: ToolInfo = serde_json::from_str(json).unwrap();
        assert_eq!(tool.name, "write");
        assert!(tool.input.is_some());
    }

    #[test]
    fn parse_model_info() {
        let json = r#"{"id":"anthropic/claude-sonnet-4-5","name":"Claude Sonnet 4.5","provider_id":"anthropic"}"#;
        let model: OpenCodeModel = serde_json::from_str(json).unwrap();
        assert_eq!(model.id, "anthropic/claude-sonnet-4-5");
        assert_eq!(model.name, "Claude Sonnet 4.5");
    }
}
