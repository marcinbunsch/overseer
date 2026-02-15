//! Codex-specific JSON types for JSON-RPC protocol parsing.
//!
//! # Codex Protocol Overview
//!
//! Codex uses JSON-RPC 2.0, which has three message types:
//!
//! 1. **Notification** — One-way message, no response expected
//!    - Has `method` field
//!    - No `id` field
//!    - Example: `{"method": "item/agentMessage/delta", "params": {"delta": "Hi"}}`
//!
//! 2. **Request** — Two-way message, expects a response
//!    - Has `method` AND `id` fields
//!    - We must respond with matching `id`
//!    - Example: `{"method": "item/commandExecution/requestApproval", "id": 5, "params": {...}}`
//!
//! 3. **Response** — Reply to a request we sent
//!    - Has `id` field (no `method`)
//!    - Has `result` or `error` field
//!    - Example: `{"id": 1, "result": {"thread": {"id": "thread-123"}}}`
//!
//! # Rust Concept: Untagged Enums
//!
//! We use `#[serde(untagged)]` to parse all three message types into one enum.
//! Serde tries each variant in order until one matches. The ORDER MATTERS!
//!
//! - ServerRequest is tried FIRST (has both `id` AND `method` — most specific)
//! - Response is tried SECOND (has `id` but no `method`)
//! - Notification is tried LAST (has `method` but no `id`)
//!
//! If we put Response before ServerRequest, requests would wrongly match as responses
//! (because both have `id`, and Response doesn't require `method` to be absent).

use serde::Deserialize;

/// A JSON-RPC message from Codex.
/// Can be a notification, response, or server request.
///
/// # Rust Concept: Enums
///
/// In Rust, enums can hold data. Each variant can have different fields.
/// This is much more powerful than TypeScript's union types because the
/// compiler enforces exhaustive handling.
///
/// ```ignore
/// match message {
///     JsonRpcMessage::Notification(n) => { /* n is JsonRpcNotification */ }
///     JsonRpcMessage::Response(r) => { /* r is JsonRpcResponse */ }
///     JsonRpcMessage::ServerRequest(s) => { /* s is JsonRpcServerRequest */ }
/// }
/// // Compiler error if you forget a variant!
/// ```
///
/// # Rust Concept: #[serde(untagged)]
///
/// Normally serde expects a "tag" field to know which variant to use:
/// `{"type": "notification", ...}` or `{"notification": {...}}`
///
/// `untagged` means there's NO tag — serde tries each variant until one works.
/// It deserializes based on which fields are present in the JSON.
///
/// IMPORTANT: Order matters! More specific variants must come first.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    /// A server-initiated request (has id AND method) — most specific, try first.
    ///
    /// # Why First?
    ///
    /// ServerRequest has BOTH `id` and `method`.
    /// If Response was first, it would match (it only requires `id`).
    /// By putting ServerRequest first, we correctly identify requests.
    ServerRequest(JsonRpcServerRequest),

    /// A response to a client request (has id, no method).
    ///
    /// # Why Second?
    ///
    /// Response requires `id` but doesn't require `method`.
    /// Since ServerRequest already matched messages with both,
    /// anything with just `id` must be a Response.
    Response(JsonRpcResponse),

    /// A notification (has method, no id).
    ///
    /// # Why Last?
    ///
    /// Notification only requires `method`.
    /// After filtering out ServerRequest (has both) and Response (has id),
    /// anything with just `method` must be a Notification.
    Notification(JsonRpcNotification),
}

/// A JSON-RPC notification (no id, has method).
///
/// Notifications are fire-and-forget — no response expected.
/// Most of Codex's output is notifications (streaming text, status updates).
///
/// # Examples
///
/// ```json
/// {"method": "item/agentMessage/delta", "params": {"delta": "Hello"}}
/// {"method": "turn/completed", "params": {}}
/// {"method": "item/started", "params": {"item": {...}}}
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcNotification {
    /// The method name (e.g., "item/agentMessage/delta").
    ///
    /// This tells us what kind of notification it is.
    /// We match on this in the parser to emit the right events.
    pub method: String,

    /// Optional parameters for the notification.
    ///
    /// # Rust Concept: #[serde(default)] with Option
    ///
    /// If "params" is missing from JSON, this becomes `None`.
    /// If "params" is present, this becomes `Some(value)`.
    ///
    /// Without `#[serde(default)]`, missing "params" would fail to parse!
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

/// A JSON-RPC response to a client request (has id, no method).
///
/// When WE send a request to Codex (e.g., "thread/start"), this is the reply.
/// Contains either `result` (success) or `error` (failure).
///
/// # Example
///
/// Request we sent:
/// ```json
/// {"method": "thread/start", "id": 1, "params": {...}}
/// ```
///
/// Response we receive:
/// ```json
/// {"id": 1, "result": {"thread": {"id": "thread-123"}}}
/// ```
///
/// Or on error:
/// ```json
/// {"id": 1, "error": {"code": -1, "message": "Failed to start thread"}}
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcResponse {
    /// The request ID this is responding to.
    ///
    /// # Rust Concept: serde_json::Value
    ///
    /// JSON-RPC allows IDs to be strings, numbers, or null.
    /// `serde_json::Value` is a dynamic type that accepts any JSON value.
    ///
    /// We use it here because different systems use different ID types:
    /// - Some use integers: `"id": 1`
    /// - Some use strings: `"id": "req-123"`
    /// - Some use UUIDs: `"id": "550e8400-e29b-41d4-a716-446655440000"`
    pub id: serde_json::Value,

    /// The result on success.
    ///
    /// This is present when the request succeeded.
    /// The structure varies by method — we parse it dynamically.
    #[serde(default)]
    pub result: Option<serde_json::Value>,

    /// Error details on failure.
    ///
    /// This is present when the request failed.
    /// Only one of `result` or `error` should be present.
    #[serde(default)]
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC error.
///
/// When a request fails, we get this instead of a result.
/// Follows the JSON-RPC 2.0 error format.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcError {
    /// Numeric error code.
    ///
    /// Standard codes:
    /// - -32700: Parse error
    /// - -32600: Invalid request
    /// - -32601: Method not found
    /// - -32602: Invalid params
    /// - -32603: Internal error
    /// - -32000 to -32099: Server errors (implementation-defined)
    pub code: i32,

    /// Human-readable error message.
    pub message: String,
}

/// A server-initiated request (has id AND method).
///
/// This is Codex ASKING US for something (like approval).
/// We MUST respond with the same `id`, or Codex will hang.
///
/// # Important
///
/// Unlike notifications, requests require a response!
/// The parser returns these as `ServerRequestPending` so the caller
/// knows to send a response after processing.
///
/// # Examples
///
/// Command approval:
/// ```json
/// {"method": "item/commandExecution/requestApproval", "id": 5, "params": {"command": "rm -rf test"}}
/// ```
///
/// Our response:
/// ```json
/// {"id": 5, "result": {"approved": true}}
/// ```
///
/// Or denial:
/// ```json
/// {"id": 5, "error": {"code": -1, "message": "User denied"}}
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcServerRequest {
    /// The method being requested.
    ///
    /// Examples:
    /// - "item/commandExecution/requestApproval" — asking to run a command
    /// - "item/fileChange/requestApproval" — asking to edit a file
    /// - "item/tool/requestUserInput" — asking for user input
    pub method: String,

    /// The request ID — we must include this in our response.
    pub id: serde_json::Value,

    /// Optional parameters for the request.
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

/// Result of thread/start request.
///
/// When we call "thread/start" to begin a conversation, Codex returns
/// this structure with the thread ID we should use for subsequent messages.
#[derive(Debug, Clone, Deserialize)]
pub struct ThreadStartResult {
    /// The thread info, if available.
    pub thread: Option<ThreadInfo>,
}

/// Thread information.
///
/// Contains the thread ID assigned by Codex.
#[derive(Debug, Clone, Deserialize)]
pub struct ThreadInfo {
    /// The thread ID (session ID).
    ///
    /// We use this to resume conversations or reference them later.
    pub id: Option<String>,
}

/// An item in Codex events.
///
/// Items represent things happening in the conversation:
/// - Commands being executed
/// - Files being changed
/// - Tools being called
/// - Agent messages being sent
///
/// # Rust Concept: Flat Struct with Optional Fields
///
/// Different item types have different fields. Rather than using
/// a complex enum, we use a flat struct with Optional fields.
/// The `item_type` field tells us which fields are relevant.
///
/// This is simpler than nested types and matches the JSON structure.
#[derive(Debug, Clone, Deserialize)]
pub struct CodexItem {
    /// The item type.
    ///
    /// Values: "commandExecution", "fileChange", "mcpToolCall", "agentMessage"
    ///
    /// # Rust Concept: #[serde(rename = "...")]
    ///
    /// The JSON uses "type" but that's a Rust keyword.
    /// `rename` lets us use a different name in Rust.
    #[serde(rename = "type")]
    pub item_type: String,

    /// Command string (for "commandExecution" items).
    ///
    /// Example: "git status", "npm install"
    #[serde(default)]
    pub command: Option<String>,

    /// Diff content (for "fileChange" items).
    ///
    /// Shows what changed in unified diff format.
    #[serde(default)]
    pub diff: Option<String>,

    /// File path (for "fileChange" items).
    ///
    /// # Rust Concept: #[serde(rename = "...")]
    ///
    /// JSON uses camelCase ("filePath"), Rust uses snake_case ("file_path").
    /// `rename` bridges this gap.
    #[serde(rename = "filePath")]
    #[serde(default)]
    pub file_path: Option<String>,

    /// Tool name (for "mcpToolCall" items).
    ///
    /// MCP (Model Context Protocol) tools are external tools
    /// that can be called during the conversation.
    #[serde(rename = "toolName")]
    #[serde(default)]
    pub tool_name: Option<String>,

    /// Tool arguments (for "mcpToolCall" items).
    ///
    /// The arguments vary by tool, so we use dynamic JSON.
    #[serde(default)]
    pub arguments: Option<serde_json::Value>,

    /// Message text (for "agentMessage" items).
    ///
    /// The agent's text response.
    #[serde(default)]
    pub text: Option<String>,
}

// ============================================================================
// TESTS
// ============================================================================
//
// # Rust Concept: Test Organization
//
// Tests live in a `mod tests` block with `#[cfg(test)]`.
// This keeps tests close to the code they test.
//
// Each test function:
// 1. Sets up test data (usually JSON strings)
// 2. Calls the code being tested
// 3. Asserts expected results
//
// Run with: `cargo test -p overseer-core codex::types`

#[cfg(test)]
mod tests {
    use super::*;

    /// Test parsing a notification (has method, no id).
    #[test]
    fn parse_notification() {
        let json = r#"{"method":"item/agentMessage/delta","params":{"delta":"Hello"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        // Use `matches!` macro to check enum variant
        //
        // Rust Concept: matches! macro
        //
        // `matches!(value, pattern)` returns true if value matches the pattern.
        // Cleaner than writing out the full match expression.
        assert!(matches!(msg, JsonRpcMessage::Notification(_)));

        // Destructure to access inner data
        //
        // `if let` extracts the inner value only if the pattern matches.
        // Cleaner than `match` when you only care about one variant.
        if let JsonRpcMessage::Notification(notif) = msg {
            assert_eq!(notif.method, "item/agentMessage/delta");
        }
    }

    /// Test parsing a response (has id, no method).
    #[test]
    fn parse_response() {
        let json = r#"{"id":1,"result":{"thread":{"id":"thread-123"}}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, JsonRpcMessage::Response(_)));
    }

    /// Test parsing a server request (has BOTH id AND method).
    ///
    /// This is the tricky case — must be tried BEFORE Response,
    /// or it would wrongly match as Response (which also has id).
    #[test]
    fn parse_server_request() {
        let json = r#"{"method":"item/commandExecution/requestApproval","id":5,"params":{"command":"ls"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        // Verify it's ServerRequest, NOT Response
        assert!(matches!(msg, JsonRpcMessage::ServerRequest(_)));

        if let JsonRpcMessage::ServerRequest(req) = msg {
            assert_eq!(req.method, "item/commandExecution/requestApproval");
        }
    }

    /// Test parsing a response with error.
    #[test]
    fn parse_response_with_error() {
        let json = r#"{"id":2,"error":{"code":-1,"message":"Something failed"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(json).unwrap();

        if let JsonRpcMessage::Response(resp) = msg {
            assert!(resp.error.is_some());
            assert_eq!(resp.error.unwrap().message, "Something failed");
        }
    }

    /// Test parsing thread start result.
    #[test]
    fn parse_thread_start_result() {
        let json = r#"{"thread":{"id":"thread-456"}}"#;
        let result: ThreadStartResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.thread.unwrap().id, Some("thread-456".to_string()));
    }

    /// Test parsing command execution item.
    #[test]
    fn parse_codex_item_command_execution() {
        let json = r#"{"type":"commandExecution","command":"git status"}"#;
        let item: CodexItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.item_type, "commandExecution");
        assert_eq!(item.command, Some("git status".to_string()));
    }

    /// Test parsing file change item.
    #[test]
    fn parse_codex_item_file_change() {
        let json = r#"{"type":"fileChange","filePath":"test.txt","diff":"+ new line"}"#;
        let item: CodexItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.item_type, "fileChange");
        assert_eq!(item.file_path, Some("test.txt".to_string()));
    }

    /// Test parsing MCP tool call item.
    #[test]
    fn parse_codex_item_mcp_tool_call() {
        let json = r#"{"type":"mcpToolCall","toolName":"CustomTool","arguments":{"key":"value"}}"#;
        let item: CodexItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.item_type, "mcpToolCall");
        assert_eq!(item.tool_name, Some("CustomTool".to_string()));
    }

    /// Test parsing agent message item.
    #[test]
    fn parse_codex_item_agent_message() {
        let json = r#"{"type":"agentMessage","text":"This is the response"}"#;
        let item: CodexItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.item_type, "agentMessage");
        assert_eq!(item.text, Some("This is the response".to_string()));
    }
}
