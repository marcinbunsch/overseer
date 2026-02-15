//! Claude-specific JSON types for stream parsing.
//!
//! # Purpose
//!
//! This module defines Rust structs that mirror the JSON structure Claude outputs.
//! When Claude streams events, each line is JSON that matches one of these types.
//!
//! # Rust Concept: Serde
//!
//! Serde is Rust's serialization/deserialization framework.
//! - `Serialize`: Convert Rust struct → JSON (or other formats)
//! - `Deserialize`: Convert JSON → Rust struct
//!
//! We use `#[derive(Deserialize)]` to auto-generate parsing code.
//!
//! # Example
//!
//! Claude outputs:
//! ```json
//! {"type":"assistant","session_id":"sess-123","message":{"role":"assistant","content":[...]}}
//! ```
//!
//! This becomes a `ClaudeStreamEvent` struct with:
//! - `event_type = "assistant"`
//! - `session_id = Some("sess-123")`
//! - `message = Some(AssistantMessage { ... })`

use serde::Deserialize;

use crate::agents::event::QuestionItem;

/// A Claude stream event.
///
/// This is the top-level structure for all events from Claude.
/// Different event types populate different optional fields.
///
/// # Rust Concept: Serde Field Attributes
///
/// - `#[serde(rename = "type")]` — JSON key is "type", Rust field is `event_type`
///   (We can't use `type` as a field name because it's a Rust keyword)
///
/// - `#[serde(default)]` — If the JSON key is missing, use Default::default()
///   For Option<T>, default is None. For String, default is "".
///   Without this, missing keys would cause parsing to fail.
#[derive(Debug, Clone, Deserialize)]
pub struct ClaudeStreamEvent {
    /// The event type ("assistant", "content_block_delta", "result", etc.)
    ///
    /// # Rust Concept: #[serde(rename = "...")]
    ///
    /// The JSON uses "type" as the key, but `type` is a reserved keyword in Rust.
    /// `rename` lets us use a different name in Rust while parsing the original key.
    #[serde(rename = "type")]
    pub event_type: String,

    /// Subtype for certain events (e.g., "can_use_tool" for control requests).
    #[serde(default)]
    pub subtype: Option<String>,

    /// Session ID for this conversation.
    ///
    /// # Rust Concept: Option<T> with serde
    ///
    /// `Option<String>` with `#[serde(default)]` means:
    /// - If "session_id" key exists in JSON → `Some("value")`
    /// - If "session_id" key is missing → `None`
    ///
    /// Without `default`, missing keys would fail to parse!
    #[serde(default)]
    pub session_id: Option<String>,

    /// Request ID for control requests (tool approval, questions).
    #[serde(default)]
    pub request_id: Option<String>,

    /// ID of parent Task tool_use — for subagent messages.
    ///
    /// When Claude spawns a subagent (Task tool), messages from that
    /// subagent include this field to indicate their parent.
    #[serde(default)]
    pub parent_tool_use_id: Option<String>,

    /// Control request details (tool approval, questions).
    #[serde(default)]
    pub request: Option<ControlRequest>,

    /// Assistant message with content blocks.
    #[serde(default)]
    pub message: Option<AssistantMessage>,

    /// Content block for streaming events.
    #[serde(default)]
    pub content_block: Option<ContentBlock>,

    /// Delta for streaming text updates.
    #[serde(default)]
    pub delta: Option<Delta>,

    /// Result string for completion events.
    #[serde(default)]
    pub result: Option<String>,
}

/// A control request from Claude (tool approval, question, etc.)
///
/// Control requests are how Claude asks for permission or input.
/// The frontend must respond before Claude continues.
///
/// # Examples
///
/// Tool approval request:
/// ```json
/// {
///   "subtype": "can_use_tool",
///   "tool_name": "Bash",
///   "input": {"command": "rm -rf /tmp/test"}
/// }
/// ```
///
/// Question request:
/// ```json
/// {
///   "subtype": "can_use_tool",
///   "tool_name": "AskUserQuestion",
///   "input": {"questions": [...]}
/// }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct ControlRequest {
    /// The request subtype (always "can_use_tool" for now).
    pub subtype: String,

    /// The tool Claude wants to use.
    pub tool_name: String,

    /// Tool input as arbitrary JSON.
    ///
    /// # Rust Concept: serde_json::Value
    ///
    /// `serde_json::Value` is a dynamic JSON type. It can hold:
    /// - Objects (like JS objects)
    /// - Arrays
    /// - Strings, numbers, booleans, null
    ///
    /// We use it when the structure varies by tool type.
    /// Later we deserialize it into specific types (e.g., AskUserQuestionInput).
    #[serde(default)]
    pub input: Option<serde_json::Value>,

    /// The unique ID of this tool use (for correlation).
    #[serde(default)]
    pub tool_use_id: Option<String>,

    /// Reason for the decision (for auto-approved tools).
    #[serde(default)]
    pub decision_reason: Option<String>,
}

/// Assistant message with content blocks.
///
/// This is the main message structure containing Claude's response.
/// The `content` array can have multiple blocks of different types.
#[derive(Debug, Clone, Deserialize)]
pub struct AssistantMessage {
    /// The role (always "assistant" for these messages).
    pub role: String,

    /// Content blocks in this message.
    ///
    /// # Rust Concept: Vec<T>
    ///
    /// `Vec<ContentBlock>` is a growable array (vector) of ContentBlocks.
    /// - Like `ContentBlock[]` in TypeScript
    /// - Like `ArrayList<ContentBlock>` in Java
    ///
    /// Vec is the most common collection type in Rust.
    pub content: Vec<ContentBlock>,
}

/// A content block in a message (text, thinking, tool_use).
///
/// Claude's responses contain multiple content blocks:
/// - `text`: Regular text response
/// - `thinking`: Claude's internal reasoning (with extended thinking enabled)
/// - `tool_use`: A tool call (Bash, Edit, Read, etc.)
///
/// # Rust Concept: Optional Fields
///
/// Different block types have different fields:
/// - text block: only `text` is set
/// - thinking block: only `thinking` is set
/// - tool_use block: `id`, `name`, and `input` are set
///
/// We make all type-specific fields Optional to handle all cases
/// in a single struct. Serde's `#[serde(default)]` handles missing keys.
#[derive(Debug, Clone, Deserialize)]
pub struct ContentBlock {
    /// The block type ("text", "thinking", "tool_use").
    ///
    /// We use this to know which optional fields to read.
    #[serde(rename = "type")]
    pub block_type: String,

    /// Text content (for "text" blocks).
    #[serde(default)]
    pub text: Option<String>,

    /// Thinking content (for "thinking" blocks).
    ///
    /// This is Claude's internal reasoning when extended thinking is enabled.
    #[serde(default)]
    pub thinking: Option<String>,

    /// Block ID (for "tool_use" blocks).
    ///
    /// Used to correlate tool results back to tool calls.
    #[serde(default)]
    pub id: Option<String>,

    /// Tool name (for "tool_use" blocks).
    ///
    /// Examples: "Bash", "Edit", "Read", "Write", "Task"
    #[serde(default)]
    pub name: Option<String>,

    /// Tool input (for "tool_use" blocks).
    ///
    /// The structure varies by tool type:
    /// - Bash: `{"command": "..."}`
    /// - Edit: `{"file_path": "...", "old_string": "...", "new_string": "..."}`
    /// - Read: `{"file_path": "..."}`
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

/// Delta for streaming text updates.
///
/// During streaming, Claude sends incremental text updates.
/// Each delta contains a small piece of the full response.
///
/// # Example
///
/// ```json
/// {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}
/// {"type": "content_block_delta", "delta": {"type": "text_delta", "text": " world"}}
/// {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "!"}}
/// ```
///
/// Concatenating the text fields gives: "Hello world!"
#[derive(Debug, Clone, Deserialize)]
pub struct Delta {
    /// The delta type (usually "text_delta").
    #[serde(rename = "type")]
    pub delta_type: String,

    /// The text chunk for this delta.
    #[serde(default)]
    pub text: Option<String>,
}

/// Input for AskUserQuestion tool.
///
/// When Claude needs user input (choosing between options, answering questions),
/// it uses this tool. The questions array contains one or more questions.
///
/// # Example JSON
///
/// ```json
/// {
///   "questions": [
///     {
///       "question": "Which database should we use?",
///       "header": "Database",
///       "options": [
///         {"label": "PostgreSQL", "description": "Relational database"},
///         {"label": "MongoDB", "description": "Document database"}
///       ],
///       "multi_select": false
///     }
///   ]
/// }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct AskUserQuestionInput {
    /// The questions to ask the user.
    ///
    /// `QuestionItem` is defined in `agents/event.rs` and shared
    /// across all agent types for consistency.
    pub questions: Vec<QuestionItem>,
}

/// Input for ExitPlanMode tool.
///
/// When Claude finishes planning and wants user approval,
/// it calls this tool with the plan content.
///
/// # Example JSON
///
/// ```json
/// {
///   "plan": "1. Create database schema\n2. Implement API endpoints\n3. Add tests"
/// }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct ExitPlanModeInput {
    /// The plan content for user review.
    ///
    /// May be None if Claude exited plan mode without a written plan.
    #[serde(default)]
    pub plan: Option<String>,
}

// ============================================================================
// TESTS
// ============================================================================
//
// These tests verify that our types correctly deserialize Claude's JSON output.
// We test various event types to ensure the serde attributes work correctly.

#[cfg(test)]
mod tests {
    use super::*;

    /// Test parsing a basic assistant event with text content.
    #[test]
    fn parse_assistant_event() {
        // Use raw string literal r#"..."# to avoid escaping quotes
        //
        // Rust Concept: Raw Strings
        //
        // r#"..."# lets you include literal " characters without escaping.
        // Useful for JSON strings. The # can be repeated for nesting:
        // r##"..."## allows r#"..."# inside.
        let json = r#"{
            "type": "assistant",
            "session_id": "sess-123",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Hello!"}
                ]
            }
        }"#;

        // serde_json::from_str parses JSON string into our struct
        // .unwrap() panics if parsing fails (OK in tests)
        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();

        // Assertions verify the parsed data
        assert_eq!(event.event_type, "assistant");
        assert_eq!(event.session_id, Some("sess-123".to_string()));
        assert!(event.message.is_some());

        // .unwrap() extracts the value from Option, panics if None
        let message = event.message.unwrap();
        assert_eq!(message.content.len(), 1);
        assert_eq!(message.content[0].text, Some("Hello!".to_string()));
    }

    /// Test parsing a control request for tool approval.
    #[test]
    fn parse_control_request() {
        let json = r#"{
            "type": "control_request",
            "request_id": "req-456",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "input": {"command": "ls -la"}
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "control_request");
        assert_eq!(event.request_id, Some("req-456".to_string()));
        assert!(event.request.is_some());
        let request = event.request.unwrap();
        assert_eq!(request.tool_name, "Bash");
    }

    /// Test parsing content_block_start for tool streaming.
    #[test]
    fn parse_content_block_start() {
        let json = r#"{
            "type": "content_block_start",
            "content_block": {
                "type": "tool_use",
                "name": "Edit",
                "id": "tool-789"
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_start");
        assert!(event.content_block.is_some());
        let block = event.content_block.unwrap();
        assert_eq!(block.name, Some("Edit".to_string()));
    }

    /// Test parsing streaming text delta.
    #[test]
    fn parse_content_block_delta() {
        let json = r#"{
            "type": "content_block_delta",
            "delta": {
                "type": "text_delta",
                "text": "streaming text"
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_delta");
        assert!(event.delta.is_some());
        let delta = event.delta.unwrap();
        assert_eq!(delta.text, Some("streaming text".to_string()));
    }

    /// Test parsing result event (turn complete).
    #[test]
    fn parse_result_event() {
        let json = r#"{
            "type": "result",
            "result": "success"
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "result");
        assert_eq!(event.result, Some("success".to_string()));
    }

    /// Test parsing thinking block (extended thinking).
    #[test]
    fn parse_thinking_block() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "Let me analyze this..."}
                ]
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        let message = event.message.unwrap();
        assert_eq!(message.content[0].block_type, "thinking");
        assert_eq!(
            message.content[0].thinking,
            Some("Let me analyze this...".to_string())
        );
    }

    /// Test parsing tool_use block with input.
    #[test]
    fn parse_tool_use_block() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool-123",
                        "name": "Edit",
                        "input": {"file": "test.txt", "old_string": "foo", "new_string": "bar"}
                    }
                ]
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        let message = event.message.unwrap();
        let block = &message.content[0];
        assert_eq!(block.block_type, "tool_use");
        assert_eq!(block.name, Some("Edit".to_string()));
        assert!(block.input.is_some());
    }

    /// Test parsing parent_tool_use_id for subagent messages.
    #[test]
    fn parse_parent_tool_use_id() {
        let json = r#"{
            "type": "assistant",
            "parent_tool_use_id": "parent-task-id",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Child message"}]
            }
        }"#;

        let event: ClaudeStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.parent_tool_use_id, Some("parent-task-id".to_string()));
    }

    /// Test parsing AskUserQuestion input.
    #[test]
    fn parse_ask_user_question_input() {
        let json = r#"{
            "questions": [
                {
                    "question": "Which option?",
                    "header": "Choice",
                    "options": [
                        {"label": "Option A", "description": "First option"},
                        {"label": "Option B", "description": "Second option"}
                    ],
                    "multi_select": false
                }
            ]
        }"#;

        let input: AskUserQuestionInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.questions.len(), 1);
        assert_eq!(input.questions[0].question, "Which option?");
        assert_eq!(input.questions[0].options.len(), 2);
    }

    /// Test parsing ExitPlanMode input with plan.
    #[test]
    fn parse_exit_plan_mode_input() {
        let json = r#"{"plan": "1. Do this\n2. Do that"}"#;
        let input: ExitPlanModeInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.plan, Some("1. Do this\n2. Do that".to_string()));
    }

    /// Test parsing ExitPlanMode input without plan.
    #[test]
    fn parse_exit_plan_mode_input_without_plan() {
        let json = r#"{}"#;
        let input: ExitPlanModeInput = serde_json::from_str(json).unwrap();
        assert!(input.plan.is_none());
    }
}
