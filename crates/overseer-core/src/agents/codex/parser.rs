//! Codex stream parser.
//!
//! Parses line-by-line JSON-RPC output from Codex and emits AgentEvents.
//!
//! # How Codex Differs from Claude
//!
//! Codex uses JSON-RPC 2.0 protocol instead of custom streaming JSON:
//! - **Notifications**: One-way messages (no response expected)
//! - **Requests**: Two-way messages (response required)
//! - **Responses**: Replies to our requests
//!
//! This parser handles notifications and server-initiated requests.
//! The caller is responsible for sending responses to requests.
//!
//! # JSON-RPC 2.0 Basics
//!
//! Notification (no `id` field):
//! ```json
//! {"method": "item/agentMessage/delta", "params": {"delta": "Hello"}}
//! ```
//!
//! Request (has `id` field, expects response):
//! ```json
//! {"method": "item/commandExecution/requestApproval", "id": 5, "params": {"command": "rm -rf"}}
//! ```
//!
//! Response (has `id` field, no `method`):
//! ```json
//! {"id": 5, "result": {"approved": true}}
//! ```

use crate::agents::event::{AgentEvent, ToolMeta};
use crate::approval::parse_command_prefixes;

use super::types::{CodexItem, JsonRpcMessage, JsonRpcNotification, JsonRpcServerRequest};

/// Result type for server requests that need a response.
///
/// When Codex sends a request (not notification), it expects us to respond.
/// This struct captures the info needed to send that response later.
///
/// # Usage Pattern
///
/// 1. Parser returns `(events, pending_requests)`
/// 2. Caller displays events to user
/// 3. When user approves/denies, caller uses `pending.id` to send response
/// 4. Codex continues after receiving response
#[derive(Debug, Clone)]
pub struct ServerRequestPending {
    /// The request ID to use in the response.
    ///
    /// # Rust Concept: serde_json::Value for Dynamic IDs
    ///
    /// JSON-RPC allows IDs to be strings, numbers, or null.
    /// `serde_json::Value` handles all these cases dynamically.
    /// When responding, we echo back this exact value.
    pub id: serde_json::Value,

    /// The method name of the request.
    ///
    /// Examples:
    /// - "item/commandExecution/requestApproval"
    /// - "item/fileChange/requestApproval"
    pub method: String,
}

/// Parser state for a Codex conversation.
///
/// # Differences from ClaudeParser
///
/// 1. Returns `(Vec<AgentEvent>, Vec<ServerRequestPending>)` instead of just events
/// 2. Tracks command execution state (are we inside a command?)
/// 3. Uses JSON-RPC message types instead of custom event types
#[derive(Debug, Default)]
pub struct CodexParser {
    /// Thread ID (session ID) for this conversation.
    ///
    /// Codex calls it "thread_id", we map it to session_id for consistency.
    thread_id: Option<String>,

    /// Buffer for incomplete lines.
    ///
    /// Same buffering pattern as ClaudeParser — data arrives in chunks,
    /// we buffer until we have complete newline-terminated lines.
    buffer: String,

    /// Track whether we're currently streaming command output.
    ///
    /// When a command starts, we set this to true.
    /// When it completes, we set it back to false.
    /// This helps the UI know when to show the command output area.
    in_command_execution: bool,
}

/// # Rust Concept: Default Trait
///
/// `#[derive(Default)]` generates a `default()` function that creates
/// the struct with all fields set to their default values:
/// - `Option<T>` → `None`
/// - `String` → `""`
/// - `bool` → `false`
/// - `Vec<T>` → empty vector
impl CodexParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the thread ID (session ID) if one has been set.
    pub fn thread_id(&self) -> Option<&str> {
        self.thread_id.as_deref()
    }

    /// Set the thread ID (for session continuity).
    pub fn set_thread_id(&mut self, thread_id: Option<String>) {
        self.thread_id = thread_id;
    }

    /// Check if we're currently in a command execution.
    ///
    /// # Why This Matters
    ///
    /// The UI uses this to:
    /// - Show a "running command" indicator
    /// - Route output deltas to the terminal area
    /// - Know when to hide the command UI
    pub fn in_command_execution(&self) -> bool {
        self.in_command_execution
    }

    /// Feed data to the parser and collect emitted events.
    ///
    /// Returns a tuple of (events, pending_server_requests).
    /// Server requests need to be responded to by the caller.
    ///
    /// # Rust Concept: Returning Tuples
    ///
    /// `(Vec<AgentEvent>, Vec<ServerRequestPending>)` is a tuple type.
    /// Tuples group multiple values of different types.
    ///
    /// Access tuple elements by index: `result.0` and `result.1`
    /// Or destructure: `let (events, pending) = parser.feed(data);`
    pub fn feed(&mut self, data: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let mut events = Vec::new();
        let mut pending_requests = Vec::new();

        // Append data to buffer
        self.buffer.push_str(data);

        // Take ownership of buffer to avoid borrow issues
        // (Same pattern as ClaudeParser — see that file for detailed explanation)
        let buffer = std::mem::take(&mut self.buffer);
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        // Keep the last incomplete line in the buffer
        if let Some(incomplete) = lines.pop() {
            self.buffer = incomplete.to_string();
        }

        // Process each complete line
        for line in lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                // parse_line returns a tuple, we extend both vectors
                let (line_events, line_pending) = self.parse_line(trimmed);
                events.extend(line_events);
                pending_requests.extend(line_pending);
            }
        }

        (events, pending_requests)
    }

    /// Flush any remaining buffered content.
    pub fn flush(&mut self) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let remaining = std::mem::take(&mut self.buffer);
        let trimmed = remaining.trim();
        if !trimmed.is_empty() {
            self.parse_line(trimmed)
        } else {
            (Vec::new(), Vec::new())
        }
    }

    /// Parse a single complete line of JSON.
    ///
    /// # Rust Concept: Pattern Matching on Enums
    ///
    /// `JsonRpcMessage` is an enum with three variants:
    /// - `ServerRequest` — Codex asking us something
    /// - `Response` — Reply to something we asked
    /// - `Notification` — One-way message from Codex
    ///
    /// We use `match` to handle each variant differently.
    fn parse_line(&mut self, line: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        // Try to parse as a JSON-RPC message
        //
        // The `JsonRpcMessage` enum uses #[serde(untagged)] which means
        // serde will try each variant in order until one matches.
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => return (Vec::new(), Vec::new()), // Invalid JSON, skip
        };

        // Handle each message type
        match msg {
            // Responses are replies to requests WE sent (e.g., thread/start)
            // We don't emit events for these — the caller handles them directly
            JsonRpcMessage::Response(_resp) => (Vec::new(), Vec::new()),

            // Server requests need a response from us
            // Return both events (to show UI) and pending (to track response)
            JsonRpcMessage::ServerRequest(req) => self.handle_server_request(&req),

            // Notifications are fire-and-forget messages
            // We just emit events, no response needed
            JsonRpcMessage::Notification(notif) => (self.handle_notification(&notif), Vec::new()),
        }
    }

    /// Handle a server-initiated request.
    ///
    /// Server requests are Codex asking us for permission or input.
    /// We emit events for the UI and return pending requests for tracking.
    ///
    /// # Rust Concept: &self vs &mut self
    ///
    /// This method takes `&self` (immutable borrow) because it doesn't
    /// modify parser state. It just translates a request to events.
    /// Compare to `handle_notification` which takes `&mut self` because
    /// it updates `in_command_execution`.
    fn handle_server_request(
        &self,
        req: &JsonRpcServerRequest,
    ) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        // Get params, defaulting to empty object if missing
        //
        // .clone() creates a copy of the Option<Value>
        // .unwrap_or(...) extracts the value or uses the default
        // serde_json::json!({}) creates an empty JSON object
        let params = req.params.clone().unwrap_or(serde_json::json!({}));

        // Create pending request for caller to track
        let pending = ServerRequestPending {
            id: req.id.clone(),
            method: req.method.clone(),
        };

        // Match on the method name
        //
        // .as_str() converts String to &str for pattern matching
        match req.method.as_str() {
            // Command approval request (e.g., "rm -rf test")
            "item/commandExecution/requestApproval" => {
                // Extract command string from params
                //
                // Rust Concept: Chained Option methods
                //
                // params.get("command") → Option<&Value>
                // .and_then(|v| v.as_str()) → Option<&str>
                // .unwrap_or("") → &str (empty if not found)
                // .to_string() → String (owned copy)
                let command = params
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // Parse command into prefixes for auto-approval
                let prefixes = parse_command_prefixes(&command);

                let event = AgentEvent::ToolApproval {
                    // Convert JSON Value to string for request_id
                    request_id: req.id.to_string(),
                    name: "Bash".to_string(),
                    input: params,
                    display_input: command,
                    prefixes: Some(prefixes),
                };

                (vec![event], vec![pending])
            }

            // File change approval request
            "item/fileChange/requestApproval" => {
                // Pretty-print params for display
                //
                // .unwrap_or_else(|_| ...) is like .unwrap_or() but lazily
                // evaluates the default. Useful when default is expensive.
                let display_input =
                    serde_json::to_string_pretty(&params).unwrap_or_else(|_| "{}".to_string());

                let event = AgentEvent::ToolApproval {
                    request_id: req.id.to_string(),
                    name: "Edit".to_string(),
                    input: params,
                    display_input,
                    prefixes: None, // No command prefixes for file changes
                };

                (vec![event], vec![pending])
            }

            // User input request (custom tool)
            "item/tool/requestUserInput" => {
                let display_input =
                    serde_json::to_string_pretty(&params).unwrap_or_else(|_| "{}".to_string());

                let event = AgentEvent::ToolApproval {
                    request_id: req.id.to_string(),
                    name: "UserInput".to_string(),
                    input: params,
                    display_input,
                    prefixes: None,
                };

                (vec![event], vec![pending])
            }

            // Unknown request — return pending so caller can auto-accept
            //
            // We don't emit events for unknown requests, but we still
            // need to respond to them. The caller should auto-approve.
            _ => (Vec::new(), vec![pending]),
        }
    }

    /// Handle a notification.
    ///
    /// Notifications are one-way messages from Codex. No response needed.
    /// We emit events for the UI to display.
    ///
    /// # Rust Concept: &mut self
    ///
    /// This method takes `&mut self` because it modifies
    /// `self.in_command_execution` when commands start/complete.
    fn handle_notification(&mut self, notif: &JsonRpcNotification) -> Vec<AgentEvent> {
        // Get params, defaulting to empty object
        let params = notif.params.clone().unwrap_or(serde_json::json!({}));

        match notif.method.as_str() {
            // Streaming text delta from agent
            //
            // This is the main text output — like TypeScript's `text` in ChatStore
            "item/agentMessage/delta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    return vec![AgentEvent::Text {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Item started (command, file change, tool call)
            //
            // Different item types have different fields.
            // We parse into CodexItem struct to handle all cases.
            "item/started" => {
                // Try to extract and parse the item
                //
                // Rust Concept: Nested match with early return
                //
                // This pattern is common: try to parse, return empty if failed.
                // The `match` inside `match` handles nested Option/Result.
                let item: CodexItem = match params.get("item") {
                    Some(v) => match serde_json::from_value(v.clone()) {
                        Ok(i) => i,
                        Err(_) => return Vec::new(),
                    },
                    None => return Vec::new(),
                };

                // Handle different item types
                match item.item_type.as_str() {
                    // Command execution started
                    "commandExecution" => {
                        // Update state — we're now in a command
                        self.in_command_execution = true;

                        // Format command like Claude's Bash tool
                        let command = item.command.as_deref().unwrap_or("");
                        let input = serde_json::json!({ "command": command });
                        let input_str = serde_json::to_string_pretty(&input)
                            .unwrap_or_else(|_| "{}".to_string());

                        vec![AgentEvent::Message {
                            content: format!("[Bash]\n{input_str}"),
                            tool_meta: Some(ToolMeta {
                                tool_name: "Bash".to_string(),
                                lines_added: None,
                                lines_removed: None,
                            }),
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }]
                    }

                    // File change started
                    "fileChange" => {
                        // Extract diff and path
                        //
                        // .as_deref() converts Option<String> to Option<&str>
                        // Then .unwrap_or("") gives &str
                        let diff = item.diff.as_deref().unwrap_or("");
                        let file_path = item.file_path.as_deref().unwrap_or("");

                        // Format like Claude's Edit tool
                        let input = serde_json::json!({
                            "file_path": file_path,
                            "old_string": "",
                            "new_string": diff
                        });
                        let input_str = serde_json::to_string_pretty(&input)
                            .unwrap_or_else(|_| "{}".to_string());

                        vec![AgentEvent::Message {
                            content: format!("[Edit]\n{input_str}"),
                            tool_meta: Some(ToolMeta {
                                tool_name: "Edit".to_string(),
                                lines_added: None,
                                lines_removed: None,
                            }),
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }]
                    }

                    // MCP tool call (external tools)
                    "mcpToolCall" => {
                        let tool_name = item.tool_name.as_deref().unwrap_or("Tool");

                        // Format arguments as pretty JSON
                        //
                        // This shows a common pattern: transform Option contents
                        // with .map(), then unwrap with a default
                        let args_str = item
                            .arguments
                            .as_ref()
                            .map(|a| {
                                serde_json::to_string_pretty(a).unwrap_or_else(|_| "".to_string())
                            })
                            .unwrap_or_default();

                        let content = if args_str.is_empty() {
                            format!("[{tool_name}]")
                        } else {
                            format!("[{tool_name}]\n{args_str}")
                        };

                        vec![AgentEvent::Message {
                            content,
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }]
                    }

                    // Unknown item type — ignore
                    _ => Vec::new(),
                }
            }

            // Item completed
            "item/completed" => {
                let item: CodexItem = match params.get("item") {
                    Some(v) => match serde_json::from_value(v.clone()) {
                        Ok(i) => i,
                        Err(_) => return Vec::new(),
                    },
                    None => return Vec::new(),
                };

                match item.item_type.as_str() {
                    // Command finished — update state
                    "commandExecution" => {
                        self.in_command_execution = false;
                        Vec::new()
                    }

                    // Agent message completed — emit the final text
                    "agentMessage" => {
                        if let Some(text) = item.text {
                            if !text.is_empty() {
                                return vec![AgentEvent::Message {
                                    content: text,
                                    tool_meta: None,
                                    parent_tool_use_id: None,
                                    tool_use_id: None,
                                    is_info: None,
                                }];
                            }
                        }
                        Vec::new()
                    }

                    _ => Vec::new(),
                }
            }

            // Turn completed — agent is done responding
            "turn/completed" => vec![AgentEvent::TurnComplete],

            // Command output delta — streaming terminal output
            "item/commandExecution/outputDelta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    // Use BashOutput instead of Text so UI routes to terminal
                    return vec![AgentEvent::BashOutput {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Reasoning delta — agent's thinking
            "item/reasoning/summaryTextDelta" => {
                if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                    return vec![AgentEvent::Text {
                        text: delta.to_string(),
                    }];
                }
                Vec::new()
            }

            // Error notification
            "error" => {
                let message = params
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");

                vec![AgentEvent::Message {
                    content: format!("Error: {message}"),
                    tool_meta: None,
                    parent_tool_use_id: None,
                    tool_use_id: None,
                    is_info: None,
                }]
            }

            // Informational notifications — ignore
            //
            // Rust Concept: Pattern OR
            //
            // `|` lets you match multiple patterns in one arm.
            // This is cleaner than having multiple arms with the same body.
            "thread/name/updated"
            | "thread/tokenUsage/updated"
            | "thread/compacted"
            | "account/updated"
            | "account/rateLimits/updated"
            | "deprecationNotice" => Vec::new(),

            // Unknown notification — ignore
            _ => Vec::new(),
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_parser_has_no_thread_id() {
        let parser = CodexParser::new();
        assert!(parser.thread_id().is_none());
    }

    #[test]
    fn set_thread_id() {
        let mut parser = CodexParser::new();
        parser.set_thread_id(Some("thread-123".to_string()));
        assert_eq!(parser.thread_id(), Some("thread-123"));
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = CodexParser::new();
        let (events, pending) = parser.feed("\n");
        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_invalid_json() {
        let mut parser = CodexParser::new();
        let (events, pending) = parser.feed("not json\n");
        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_agent_message_delta() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/agentMessage/delta","params":{"delta":"Hello"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::Text { text } if text == "Hello")));
    }

    #[test]
    fn parse_turn_completed() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"turn/completed","params":{}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn parse_command_execution_started() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"git status"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(parser.in_command_execution());
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Bash]") && meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_command_execution_completed() {
        let mut parser = CodexParser::new();

        // Start command
        let start = r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"ls"}}}"#;
        let _ = parser.feed(&format!("{start}\n"));
        assert!(parser.in_command_execution());

        // Complete command
        let complete =
            r#"{"method":"item/completed","params":{"item":{"type":"commandExecution"}}}"#;
        let _ = parser.feed(&format!("{complete}\n"));
        assert!(!parser.in_command_execution());
    }

    #[test]
    fn parse_command_output_delta() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/commandExecution/outputDelta","params":{"delta":"file.txt\n"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::BashOutput { text } if text == "file.txt\n"
        )));
    }

    #[test]
    fn parse_file_change_started() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"fileChange","filePath":"test.txt","diff":"+ new line"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Edit]") && meta.tool_name == "Edit"
        )));
    }

    #[test]
    fn parse_mcp_tool_call() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/started","params":{"item":{"type":"mcpToolCall","toolName":"CustomTool","arguments":{"key":"value"}}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("[CustomTool]")
        )));
    }

    #[test]
    fn parse_agent_message_completed() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"Response text"}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content == "Response text"
        )));
    }

    #[test]
    fn parse_command_approval_request() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/commandExecution/requestApproval","id":5,"params":{"command":"rm -rf test"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].method, "item/commandExecution/requestApproval");

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, prefixes, .. }
            if name == "Bash" && prefixes.as_ref().is_some_and(|p| p.contains(&"rm".to_string()))
        )));
    }

    #[test]
    fn parse_file_change_approval_request() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"item/fileChange/requestApproval","id":"req-1","params":{"file":"test.txt"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, .. } if name == "Edit"
        )));
    }

    #[test]
    fn parse_user_input_request() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/tool/requestUserInput","id":10,"params":{"prompt":"Enter value"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, .. } if name == "UserInput"
        )));
    }

    #[test]
    fn parse_error_notification() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"error","params":{"message":"Something went wrong"}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("Something went wrong")
        )));
    }

    #[test]
    fn parse_reasoning_delta() {
        let mut parser = CodexParser::new();
        let line =
            r#"{"method":"item/reasoning/summaryTextDelta","params":{"delta":"thinking..."}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text == "thinking..."
        )));
    }

    #[test]
    fn ignore_informational_notifications() {
        let mut parser = CodexParser::new();

        let notifications = [
            r#"{"method":"thread/name/updated","params":{}}"#,
            r#"{"method":"thread/tokenUsage/updated","params":{}}"#,
            r#"{"method":"account/updated","params":{}}"#,
        ];

        for line in notifications {
            let (events, _) = parser.feed(&format!("{line}\n"));
            assert!(events.is_empty());
        }
    }

    #[test]
    fn unknown_server_request_returns_pending() {
        let mut parser = CodexParser::new();
        let line = r#"{"method":"unknown/request","id":99,"params":{}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].method, "unknown/request");
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = CodexParser::new();

        // Send partial data
        let (events1, _) = parser.feed(r#"{"method":"turn/"#);
        assert!(events1.is_empty());

        // Complete the line
        let (events2, _) = parser.feed(r#"completed","params":{}}"#);
        assert!(events2.is_empty()); // Still no newline

        // Send newline
        let (events3, _) = parser.feed("\n");
        assert!(events3
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn response_messages_ignored() {
        let mut parser = CodexParser::new();
        let line = r#"{"id":1,"result":{"thread":{"id":"thread-123"}}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
        assert!(pending.is_empty());
    }
}
