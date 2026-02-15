//! Copilot-specific JSON types for ACP (Agent Communication Protocol) parsing.
//!
//! # Copilot Protocol Overview
//!
//! Copilot uses JSON-RPC 2.0 with the ACP extension, similar to Codex but with
//! different message structures. Key differences:
//!
//! 1. **Session updates** use `session/update` notifications with nested `update` object
//! 2. **Permission requests** use `session/request_permission` server requests
//! 3. **Tool calls** are tracked via `tool_call` and `tool_call_update` session updates
//!
//! # Message Flow Example
//!
//! ```text
//! Client → Server: initialize request
//! Server → Client: initialize response (capabilities)
//! Client → Server: session/new request
//! Server → Client: session/new response (sessionId)
//! Client → Server: session/prompt request
//! Server → Client: session/update notifications (streaming)
//! Server → Client: session/request_permission request (tool approval)
//! Client → Server: permission response
//! ```

use serde::Deserialize;

/// A JSON-RPC message from Copilot (ACP protocol).
///
/// Same structure as Codex but with different notification/request types.
/// The variant order matters for `#[serde(untagged)]` - see Codex types for explanation.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    /// Server request (has id AND method) — most specific, try first.
    ServerRequest(JsonRpcServerRequest),
    /// Response (has id, no method).
    Response(JsonRpcResponse),
    /// Notification (has method, no id).
    Notification(JsonRpcNotification),
}

/// A JSON-RPC notification.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcNotification {
    pub method: String,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

/// A JSON-RPC response.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcResponse {
    pub id: serde_json::Value,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC error.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

/// A JSON-RPC server request (permission requests, etc.).
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcServerRequest {
    pub method: String,
    pub id: serde_json::Value,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

/// Session update types in the ACP protocol.
///
/// These are the values of `sessionUpdate` field in `session/update` notifications.
#[derive(Debug, Clone, Deserialize)]
pub struct SessionUpdate {
    /// The update type: "agent_message_chunk", "tool_call", "tool_call_update", "plan", etc.
    #[serde(rename = "sessionUpdate")]
    pub session_update: Option<String>,

    /// Alternative location for type field.
    #[serde(rename = "type")]
    pub update_type: Option<String>,

    /// Content for message chunks.
    #[serde(default)]
    pub content: Option<ContentItem>,

    /// Tool call ID (for tool_call and tool_call_update).
    #[serde(rename = "toolCallId")]
    #[serde(default)]
    pub tool_call_id: Option<String>,

    /// Tool title (human-readable name).
    #[serde(default)]
    pub title: Option<String>,

    /// Tool kind: "execute", "edit", "read", "search", "fetch", "think", etc.
    #[serde(default)]
    pub kind: Option<String>,

    /// Tool status: "pending", "in_progress", "completed".
    #[serde(default)]
    pub status: Option<String>,

    /// Raw input for tool calls.
    #[serde(rename = "rawInput")]
    #[serde(default)]
    pub raw_input: Option<serde_json::Value>,

    /// Alternative input field.
    #[serde(default)]
    pub input: Option<serde_json::Value>,

    /// Raw output for tool results.
    #[serde(rename = "rawOutput")]
    #[serde(default)]
    pub raw_output: Option<serde_json::Value>,

    /// Alternative output field.
    #[serde(default)]
    pub output: Option<serde_json::Value>,

    /// Plan steps (for plan updates).
    #[serde(default)]
    pub steps: Option<Vec<PlanStep>>,
}

impl SessionUpdate {
    /// Get the update type, checking both field locations.
    pub fn get_type(&self) -> Option<&str> {
        self.session_update
            .as_deref()
            .or(self.update_type.as_deref())
    }

    /// Get tool input, checking both field locations.
    pub fn get_input(&self) -> Option<&serde_json::Value> {
        self.raw_input.as_ref().or(self.input.as_ref())
    }

    /// Get tool output, checking both field locations.
    pub fn get_output(&self) -> Option<&serde_json::Value> {
        self.raw_output.as_ref().or(self.output.as_ref())
    }
}

/// Content item in session updates.
#[derive(Debug, Clone, Deserialize)]
pub struct ContentItem {
    /// Content type: "text", "terminal_output", "diff".
    #[serde(rename = "type")]
    pub content_type: String,

    /// Text content.
    #[serde(default)]
    pub text: Option<String>,

    /// Terminal output.
    #[serde(default)]
    pub output: Option<String>,

    /// File path (for diff type).
    #[serde(default)]
    pub path: Option<String>,

    /// Diff content.
    #[serde(default)]
    pub diff: Option<String>,
}

/// A plan step.
#[derive(Debug, Clone, Deserialize)]
pub struct PlanStep {
    pub description: String,
    pub status: String,
}

/// Tool call info in permission requests.
#[derive(Debug, Clone, Deserialize)]
pub struct PermissionToolCall {
    /// Tool call ID for correlation.
    #[serde(rename = "toolCallId")]
    #[serde(default)]
    pub tool_call_id: Option<String>,

    /// Human-readable title.
    #[serde(default)]
    pub title: Option<String>,

    /// Tool kind: "execute", "edit", "read", etc.
    #[serde(default)]
    pub kind: Option<String>,

    /// Raw input data.
    #[serde(rename = "rawInput")]
    #[serde(default)]
    pub raw_input: Option<serde_json::Value>,
}

/// Permission option in permission requests.
#[derive(Debug, Clone, Deserialize)]
pub struct PermissionOption {
    /// Option ID: "allow_once", "allow_always", "reject_once", "reject_always".
    #[serde(rename = "optionId")]
    pub option_id: String,

    /// Human-readable name.
    pub name: String,

    /// Option kind.
    pub kind: String,
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_notification() {
        let json =
            r#"{"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk"}}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Notification(_)));
    }

    #[test]
    fn parse_server_request() {
        let json = r#"{"method":"session/request_permission","id":1,"params":{"toolCall":{"kind":"execute"}}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, JsonRpcMessage::ServerRequest(_)));
    }

    #[test]
    fn parse_response() {
        let json = r#"{"id":1,"result":{"sessionId":"sess-123"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Response(_)));
    }

    #[test]
    fn parse_session_update_message_chunk() {
        let json = r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello"}}"#;
        let update: SessionUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.get_type(), Some("agent_message_chunk"));
        assert!(update.content.is_some());
        assert_eq!(update.content.as_ref().unwrap().text, Some("Hello".to_string()));
    }

    #[test]
    fn parse_session_update_tool_call() {
        let json = r#"{"sessionUpdate":"tool_call","toolCallId":"tc-1","title":"Run command","kind":"execute","status":"pending","rawInput":{"command":"ls"}}"#;
        let update: SessionUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.get_type(), Some("tool_call"));
        assert_eq!(update.tool_call_id, Some("tc-1".to_string()));
        assert_eq!(update.kind, Some("execute".to_string()));
        assert!(update.get_input().is_some());
    }

    #[test]
    fn parse_permission_tool_call() {
        let json = r#"{"toolCallId":"tc-2","title":"Edit file","kind":"edit","rawInput":{"path":"test.txt"}}"#;
        let tool_call: PermissionToolCall = serde_json::from_str(json).unwrap();
        assert_eq!(tool_call.tool_call_id, Some("tc-2".to_string()));
        assert_eq!(tool_call.kind, Some("edit".to_string()));
    }

    #[test]
    fn parse_permission_option() {
        let json = r#"{"optionId":"allow_once","name":"Allow Once","kind":"allow_once"}"#;
        let option: PermissionOption = serde_json::from_str(json).unwrap();
        assert_eq!(option.option_id, "allow_once");
    }

    #[test]
    fn parse_plan_step() {
        let json = r#"{"description":"Install dependencies","status":"completed"}"#;
        let step: PlanStep = serde_json::from_str(json).unwrap();
        assert_eq!(step.description, "Install dependencies");
        assert_eq!(step.status, "completed");
    }

    #[test]
    fn session_update_get_type_fallback() {
        // Tests both field locations for type
        let json1 = r#"{"sessionUpdate":"tool_call"}"#;
        let update1: SessionUpdate = serde_json::from_str(json1).unwrap();
        assert_eq!(update1.get_type(), Some("tool_call"));

        let json2 = r#"{"type":"tool_call"}"#;
        let update2: SessionUpdate = serde_json::from_str(json2).unwrap();
        assert_eq!(update2.get_type(), Some("tool_call"));
    }

    #[test]
    fn session_update_get_input_fallback() {
        // Tests both field locations for input
        let json1 = r#"{"rawInput":{"command":"ls"}}"#;
        let update1: SessionUpdate = serde_json::from_str(json1).unwrap();
        assert!(update1.get_input().is_some());

        let json2 = r#"{"input":{"command":"ls"}}"#;
        let update2: SessionUpdate = serde_json::from_str(json2).unwrap();
        assert!(update2.get_input().is_some());
    }
}
