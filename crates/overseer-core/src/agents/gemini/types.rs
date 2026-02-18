//! Gemini-specific JSON types for NDJSON stream parsing.
//!
//! # Gemini Protocol Overview
//!
//! Gemini CLI uses a simpler NDJSON (Newline-Delimited JSON) format, not JSON-RPC.
//! Each line is a self-contained event with a `type` field.
//!
//! # Key Differences from Other Agents
//!
//! - **Not JSON-RPC**: Simple event objects, no request/response correlation
//! - **No tool approvals**: Uses `--approval-mode yolo` or `auto_edit`
//! - **One-shot model**: New process per message (no persistent server)
//! - **snake_case fields**: Uses `session_id`, `tool_name`, etc.
//!
//! # Event Types
//!
//! - `init`: Session start with session_id and model
//! - `message`: Text content from assistant (streaming or complete)
//! - `tool_use`: Tool invocation with parameters
//! - `tool_result`: Tool output (success or error)
//! - `error`: Error message
//! - `result`: Final event with session stats

use serde::Deserialize;

/// A Gemini stream event (NDJSON format).
///
/// Unlike JSON-RPC, each event is self-contained with a `type` discriminator.
/// Different event types populate different optional fields.
///
/// # Rust Concept: Flat Struct vs Tagged Enum
///
/// We could use `#[serde(tag = "type")]` to create a tagged enum, but that
/// requires knowing all possible types upfront. A flat struct with optional
/// fields is more resilient to new/unknown event types.
#[derive(Debug, Clone, Deserialize)]
pub struct GeminiStreamEvent {
    /// The event type: "init", "message", "tool_use", "tool_result", "error", "result".
    #[serde(rename = "type")]
    pub event_type: String,

    /// Timestamp of the event.
    #[serde(default)]
    pub timestamp: Option<String>,

    /// Session ID (from init event).
    ///
    /// # Note: snake_case
    ///
    /// Gemini CLI uses snake_case (`session_id`), not camelCase.
    /// Serde handles this automatically since Rust also uses snake_case.
    #[serde(default)]
    pub session_id: Option<String>,

    /// Model name (from init event).
    #[serde(default)]
    pub model: Option<String>,

    /// Role for message events: "assistant" or "user".
    #[serde(default)]
    pub role: Option<String>,

    /// Content for message events.
    #[serde(default)]
    pub content: Option<String>,

    /// True if this is a streaming delta (partial content).
    #[serde(default)]
    pub delta: Option<bool>,

    /// Tool name for tool_use events.
    #[serde(default)]
    pub tool_name: Option<String>,

    /// Tool ID for correlation (tool_use and tool_result).
    #[serde(default)]
    pub tool_id: Option<String>,

    /// Tool parameters/input.
    ///
    /// # Note: "parameters" not "params"
    ///
    /// Gemini uses "parameters" instead of "params" like other agents.
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,

    /// Status for tool_result: "success" or "error".
    #[serde(default)]
    pub status: Option<String>,

    /// Output for successful tool_result.
    #[serde(default)]
    pub output: Option<String>,

    /// Error message for tool_result or error events.
    #[serde(default)]
    pub error: Option<String>,

    /// Generic message field (used in error events).
    #[serde(default)]
    pub message: Option<String>,

    /// Error code (for error events).
    #[serde(default)]
    pub code: Option<String>,

    /// Success flag (for result events).
    #[serde(default)]
    pub success: Option<bool>,

    /// Session statistics (for result events).
    #[serde(default)]
    pub stats: Option<serde_json::Value>,
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_init_event() {
        let json = r#"{"type":"init","session_id":"sess-123","model":"gemini-pro","timestamp":"2024-01-01T00:00:00Z"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "init");
        assert_eq!(event.session_id, Some("sess-123".to_string()));
        assert_eq!(event.model, Some("gemini-pro".to_string()));
    }

    #[test]
    fn parse_message_event_complete() {
        let json = r#"{"type":"message","role":"assistant","content":"Hello, world!"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "message");
        assert_eq!(event.role, Some("assistant".to_string()));
        assert_eq!(event.content, Some("Hello, world!".to_string()));
        assert!(event.delta.is_none());
    }

    #[test]
    fn parse_message_event_delta() {
        let json = r#"{"type":"message","role":"assistant","content":"Hello","delta":true}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "message");
        assert_eq!(event.delta, Some(true));
    }

    #[test]
    fn parse_tool_use_event() {
        let json = r#"{"type":"tool_use","tool_name":"shell","tool_id":"tool-1","parameters":{"command":"ls -la"}}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "tool_use");
        assert_eq!(event.tool_name, Some("shell".to_string()));
        assert_eq!(event.tool_id, Some("tool-1".to_string()));
        assert!(event.parameters.is_some());
    }

    #[test]
    fn parse_tool_result_success() {
        let json = r#"{"type":"tool_result","tool_id":"tool-1","status":"success","output":"file.txt\nother.txt"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "tool_result");
        assert_eq!(event.status, Some("success".to_string()));
        assert_eq!(event.output, Some("file.txt\nother.txt".to_string()));
    }

    #[test]
    fn parse_tool_result_error() {
        let json = r#"{"type":"tool_result","tool_id":"tool-1","status":"error","error":"Command failed"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "tool_result");
        assert_eq!(event.status, Some("error".to_string()));
        assert_eq!(event.error, Some("Command failed".to_string()));
    }

    #[test]
    fn parse_error_event() {
        let json = r#"{"type":"error","message":"Something went wrong","code":"E001"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "error");
        assert_eq!(event.message, Some("Something went wrong".to_string()));
        assert_eq!(event.code, Some("E001".to_string()));
    }

    #[test]
    fn parse_result_event() {
        let json = r#"{"type":"result","success":true,"stats":{"tokens_used":100}}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "result");
        assert_eq!(event.success, Some(true));
        assert!(event.stats.is_some());
    }

    #[test]
    fn unknown_fields_ignored() {
        // Gemini may add new fields; we should ignore them gracefully
        let json =
            r#"{"type":"message","role":"assistant","content":"Hi","unknown_field":"value"}"#;
        let event: GeminiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "message");
        assert_eq!(event.content, Some("Hi".to_string()));
    }
}
