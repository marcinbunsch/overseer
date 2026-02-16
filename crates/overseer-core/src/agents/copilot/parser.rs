//! Copilot stream parser.
//!
//! Parses line-by-line JSON-RPC output from Copilot (ACP protocol) and emits AgentEvents.
//!
//! # Copilot vs Codex
//!
//! Both use JSON-RPC 2.0, but Copilot has different message structures:
//!
//! | Feature | Codex | Copilot (ACP) |
//! |---------|-------|---------------|
//! | Updates | `item/started`, `item/completed` | `session/update` with nested types |
//! | Approvals | `item/commandExecution/requestApproval` | `session/request_permission` |
//! | Text streaming | `item/agentMessage/delta` | `session/update` with `agent_message_chunk` |
//!
//! # Task/Subagent Support
//!
//! Copilot supports spawning subagents (Tasks). When a tool call has `agent_type` in its input,
//! it's a Task and we track it as `activeTask` for child tool grouping via `parent_tool_use_id`.

use crate::agents::event::{AgentEvent, ToolMeta};
use crate::approval::parse_command_prefixes;

use super::types::{
    ContentItem, JsonRpcMessage, JsonRpcNotification, JsonRpcServerRequest, PermissionOption,
    PermissionToolCall, SessionUpdate,
};

/// Pending server request that needs a response.
///
/// Similar to Codex's `ServerRequestPending` — tracks requests we must respond to.
#[derive(Debug, Clone)]
pub struct ServerRequestPending {
    /// The request ID for the response.
    pub id: serde_json::Value,
    /// The method name.
    pub method: String,
}

/// Parser state for a Copilot conversation.
///
/// # Key State
///
/// - `session_id`: Session identifier for resumption
/// - `active_task`: Currently executing Task tool (for child grouping)
/// - `active_tool_calls`: Track tool names by ID (for output filtering)
#[derive(Debug, Default)]
pub struct CopilotParser {
    /// Session ID for this conversation.
    session_id: Option<String>,

    /// Buffer for incomplete lines.
    buffer: String,

    /// Currently active Task (for parent_tool_use_id on child tools).
    ///
    /// When Copilot spawns a subagent, child tool calls should be grouped
    /// under the parent Task using this ID.
    active_task: Option<String>,

    /// Active tool calls by ID — maps toolCallId to (title, kind).
    ///
    /// Used to filter output (e.g., skip Read tool content) and track completion.
    active_tool_calls: std::collections::HashMap<String, (String, String)>,
}

impl CopilotParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the session ID if one has been set.
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Set the session ID (for session continuity).
    pub fn set_session_id(&mut self, session_id: Option<String>) {
        self.session_id = session_id;
    }

    /// Feed data to the parser and collect emitted events.
    ///
    /// Returns (events, pending_server_requests) like Codex.
    pub fn feed(&mut self, data: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let mut events = Vec::new();
        let mut pending_requests = Vec::new();

        self.buffer.push_str(data);
        let buffer = std::mem::take(&mut self.buffer);
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        if let Some(incomplete) = lines.pop() {
            self.buffer = incomplete.to_string();
        }

        for line in lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
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

    /// Parse a single line of JSON-RPC.
    fn parse_line(&mut self, line: &str) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => return (Vec::new(), Vec::new()),
        };

        match msg {
            JsonRpcMessage::Response(_resp) => (Vec::new(), Vec::new()),
            JsonRpcMessage::ServerRequest(req) => self.handle_server_request(&req),
            JsonRpcMessage::Notification(notif) => (self.handle_notification(&notif), Vec::new()),
        }
    }

    /// Handle server-initiated requests (permission requests).
    fn handle_server_request(
        &self,
        req: &JsonRpcServerRequest,
    ) -> (Vec<AgentEvent>, Vec<ServerRequestPending>) {
        let params = req.params.clone().unwrap_or(serde_json::json!({}));
        let pending = ServerRequestPending {
            id: req.id.clone(),
            method: req.method.clone(),
        };

        match req.method.as_str() {
            // Permission request for tool execution
            "session/request_permission" => {
                // Extract toolCall and options from params
                let tool_call: PermissionToolCall = params
                    .get("toolCall")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or(PermissionToolCall {
                        tool_call_id: None,
                        title: None,
                        kind: None,
                        raw_input: None,
                    });

                let _options: Vec<PermissionOption> = params
                    .get("options")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                let title = tool_call.title.as_deref().unwrap_or("Permission");
                let kind = tool_call.kind.as_deref().unwrap_or("other");
                let raw_input = tool_call.raw_input.clone().unwrap_or(serde_json::json!({}));

                // Convert kind to tool name
                let tool_name = kind_to_tool_name(kind, title);

                // Extract command prefixes for Bash approvals
                let prefixes = if tool_name == "Bash" {
                    raw_input
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(parse_command_prefixes)
                } else {
                    None
                };

                // Build display input
                let display_input = if tool_name == "Bash" {
                    raw_input
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string()
                } else if let Some(url) = raw_input.get("url").and_then(|v| v.as_str()) {
                    url.to_string()
                } else if let Some(path) = raw_input.get("path").and_then(|v| v.as_str()) {
                    path.to_string()
                } else {
                    serde_json::to_string_pretty(&raw_input).unwrap_or_default()
                };

                let event = AgentEvent::ToolApproval {
                    request_id: req.id.to_string(),
                    name: tool_name,
                    input: raw_input,
                    display_input,
                    prefixes,
                    auto_approved: false,
                    is_processed: None,
                };

                (vec![event], vec![pending])
            }

            // Unknown request — return pending for caller to handle
            _ => (Vec::new(), vec![pending]),
        }
    }

    /// Handle notifications (session updates, etc.).
    fn handle_notification(&mut self, notif: &JsonRpcNotification) -> Vec<AgentEvent> {
        let params = notif.params.clone().unwrap_or(serde_json::json!({}));

        match notif.method.as_str() {
            // Main update notification containing all streaming events
            "session/update" => {
                // ACP nests update data under params.update
                let update_value = params.get("update").cloned().unwrap_or(params.clone());
                let update: SessionUpdate = match serde_json::from_value(update_value) {
                    Ok(u) => u,
                    Err(_) => return Vec::new(),
                };

                self.handle_session_update(&update)
            }

            // Protocol-level notifications — ignore
            "$/progress" | "$/cancelRequest" => Vec::new(),

            // Unknown notification
            _ => Vec::new(),
        }
    }

    /// Handle session update notifications.
    fn handle_session_update(&mut self, update: &SessionUpdate) -> Vec<AgentEvent> {
        let update_type = match update.get_type() {
            Some(t) => t,
            None => return Vec::new(),
        };

        match update_type {
            // Streaming text chunk from agent
            "agent_message_chunk" | "agent_thought_chunk" => {
                if let Some(ref content) = update.content {
                    if content.content_type == "text" {
                        if let Some(ref text) = content.text {
                            return vec![AgentEvent::Text { text: text.clone() }];
                        }
                    }
                }
                Vec::new()
            }

            // Tool call started
            "tool_call" => {
                let tool_call_id = match &update.tool_call_id {
                    Some(id) => id.clone(),
                    None => return Vec::new(),
                };

                let title = update.title.as_deref().unwrap_or("Tool");
                let kind = update.kind.as_deref().unwrap_or("other");
                let status = update.status.as_deref().unwrap_or("");

                // Track active tool call
                self.active_tool_calls
                    .insert(tool_call_id.clone(), (title.to_string(), kind.to_string()));

                if status == "pending" || status == "in_progress" {
                    let input = update.get_input();

                    // Check if this is a Task (has agent_type in input)
                    let is_task = input
                        .and_then(|i| i.get("agent_type"))
                        .and_then(|v| v.as_str())
                        .is_some();

                    if is_task {
                        // This is a Task — track it for child grouping
                        self.active_task = Some(tool_call_id.clone());

                        // Transform input: rename agent_type -> subagent_type
                        let mut transformed_input = input.cloned().unwrap_or(serde_json::json!({}));
                        if let Some(obj) = transformed_input.as_object_mut() {
                            if let Some(agent_type) = obj.remove("agent_type") {
                                obj.insert("subagent_type".to_string(), agent_type);
                            }
                        }

                        let input_str =
                            serde_json::to_string_pretty(&transformed_input).unwrap_or_default();

                        return vec![AgentEvent::Message {
                            content: format!("[Task]\n{input_str}"),
                            tool_meta: Some(ToolMeta {
                                tool_name: "Task".to_string(),
                                lines_added: None,
                                lines_removed: None,
                            }),
                            parent_tool_use_id: None,
                            tool_use_id: Some(tool_call_id),
                            is_info: None,
                        }];
                    }

                    // Regular tool — may be child of active Task
                    let tool_name = kind_to_tool_name(kind, title);
                    let input_str = input
                        .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                        .unwrap_or_default();
                    let parent_tool_use_id = self.active_task.clone();

                    let content = if input_str.is_empty() {
                        format!("[{tool_name}]")
                    } else {
                        format!("[{tool_name}]\n{input_str}")
                    };

                    return vec![AgentEvent::Message {
                        content,
                        tool_meta: Some(ToolMeta {
                            tool_name,
                            lines_added: None,
                            lines_removed: None,
                        }),
                        parent_tool_use_id,
                        tool_use_id: None,
                        is_info: None,
                    }];
                }

                Vec::new()
            }

            // Tool call completed/updated
            "tool_call_update" => {
                let tool_call_id = match &update.tool_call_id {
                    Some(id) => id.clone(),
                    None => return Vec::new(),
                };

                let status = update.status.as_deref().unwrap_or("");
                let mut events = Vec::new();

                // Get tool info for output filtering
                let tool_info = self.active_tool_calls.get(&tool_call_id).cloned();

                if status == "completed" {
                    // Handle output based on tool type
                    let is_read_tool = tool_info.as_ref().map(|(_, k)| k.as_str()) == Some("read");

                    if !is_read_tool {
                        // Process content array if present
                        if let Some(ref content) = update.content {
                            events.extend(self.process_content_item(content));
                        }

                        // Process output if no content
                        if events.is_empty() {
                            if let Some(output) = update.get_output() {
                                // Skip detailedContent if present
                                let mut clean_output = output.clone();
                                if let Some(obj) = clean_output.as_object_mut() {
                                    obj.remove("detailedContent");
                                }
                                let output_str =
                                    serde_json::to_string_pretty(&clean_output).unwrap_or_default();
                                if !output_str.is_empty() && output_str != "{}" {
                                    events.push(AgentEvent::BashOutput { text: output_str });
                                }
                            }
                        }
                    }

                    // Clean up tracking
                    self.active_tool_calls.remove(&tool_call_id);

                    // Clear active task if this was the task completing
                    if self.active_task.as_ref() == Some(&tool_call_id) {
                        self.active_task = None;
                    }
                }

                events
            }

            // Plan update
            "plan" => {
                if let Some(ref steps) = update.steps {
                    if !steps.is_empty() {
                        let plan_text = steps
                            .iter()
                            .enumerate()
                            .map(|(i, s)| format!("{}. [{}] {}", i + 1, s.status, s.description))
                            .collect::<Vec<_>>()
                            .join("\n");

                        return vec![AgentEvent::Message {
                            content: format!("Plan:\n{plan_text}"),
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }];
                    }
                }
                Vec::new()
            }

            // Informational updates — ignore
            "user_message_chunk" | "available_commands_update" | "current_mode_update" => {
                Vec::new()
            }

            // Unknown update type
            _ => Vec::new(),
        }
    }

    /// Process a content item from tool output.
    fn process_content_item(&self, content: &ContentItem) -> Vec<AgentEvent> {
        match content.content_type.as_str() {
            "text" => {
                if let Some(ref text) = content.text {
                    return vec![AgentEvent::BashOutput { text: text.clone() }];
                }
            }
            "terminal_output" => {
                if let Some(ref output) = content.output {
                    return vec![AgentEvent::BashOutput {
                        text: output.clone(),
                    }];
                }
            }
            "diff" => {
                let path = content.path.as_deref().unwrap_or("");
                let diff = content.diff.as_deref().unwrap_or("");
                let input = serde_json::json!({ "file_path": path, "diff": diff });
                let input_str = serde_json::to_string_pretty(&input).unwrap_or_default();
                return vec![AgentEvent::Message {
                    content: format!("[Edit]\n{input_str}"),
                    tool_meta: Some(ToolMeta {
                        tool_name: "Edit".to_string(),
                        lines_added: None,
                        lines_removed: None,
                    }),
                    parent_tool_use_id: None,
                    tool_use_id: None,
                    is_info: None,
                }];
            }
            _ => {}
        }
        Vec::new()
    }
}

/// Convert Copilot tool kind to standard tool name.
fn kind_to_tool_name(kind: &str, title: &str) -> String {
    match kind {
        "execute" => "Bash".to_string(),
        "edit" => "Edit".to_string(),
        "read" => "Read".to_string(),
        "search" => "Grep".to_string(),
        "fetch" => "WebFetch".to_string(),
        "think" => "Think".to_string(),
        _ => title.to_string(),
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_parser_has_no_session_id() {
        let parser = CopilotParser::new();
        assert!(parser.session_id().is_none());
    }

    #[test]
    fn set_session_id() {
        let mut parser = CopilotParser::new();
        parser.set_session_id(Some("sess-123".to_string()));
        assert_eq!(parser.session_id(), Some("sess-123"));
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = CopilotParser::new();
        let (events, pending) = parser.feed("\n");
        assert!(events.is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn parse_agent_message_chunk() {
        let mut parser = CopilotParser::new();
        let line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello world"}}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text == "Hello world"
        )));
    }

    #[test]
    fn parse_tool_call_bash() {
        let mut parser = CopilotParser::new();
        let line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","title":"Run command","kind":"execute","status":"pending","rawInput":{"command":"git status"}}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Bash]") && meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_tool_call_task() {
        let mut parser = CopilotParser::new();
        let line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"task-1","title":"Task","kind":"task","status":"pending","rawInput":{"agent_type":"explore","prompt":"Find files"}}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        // Should emit Task with toolUseId and transformed input
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_use_id: Some(_), .. }
            if content.contains("[Task]") && content.contains("subagent_type")
        )));
    }

    #[test]
    fn task_tracks_active_task() {
        let mut parser = CopilotParser::new();

        // Start a Task
        let task_line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"task-1","title":"Task","kind":"task","status":"pending","rawInput":{"agent_type":"explore"}}}}"#;
        let _ = parser.feed(&format!("{task_line}\n"));
        assert_eq!(parser.active_task, Some("task-1".to_string()));

        // Child tool should have parent_tool_use_id
        let child_line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tc-2","title":"Read","kind":"read","status":"pending","rawInput":{"path":"test.txt"}}}}"#;
        let (events, _) = parser.feed(&format!("{child_line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { parent_tool_use_id: Some(id), .. } if id == "task-1"
        )));
    }

    #[test]
    fn parse_tool_call_update_completed() {
        let mut parser = CopilotParser::new();

        // Start tool
        let start = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","kind":"execute","status":"pending"}}}"#;
        let _ = parser.feed(&format!("{start}\n"));

        // Complete tool with output
        let complete = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"tc-1","status":"completed","content":{"type":"terminal_output","output":"file.txt\n"}}}}"#;
        let (events, _) = parser.feed(&format!("{complete}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::BashOutput { text } if text == "file.txt\n"
        )));
    }

    #[test]
    fn parse_permission_request() {
        let mut parser = CopilotParser::new();
        let line = r#"{"method":"session/request_permission","id":5,"params":{"toolCall":{"toolCallId":"tc-1","title":"Run command","kind":"execute","rawInput":{"command":"rm -rf test"}},"options":[{"optionId":"allow_once","name":"Allow","kind":"allow_once"}]}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].method, "session/request_permission");

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolApproval { name, prefixes, .. }
            if name == "Bash" && prefixes.as_ref().is_some_and(|p| p.contains(&"rm".to_string()))
        )));
    }

    #[test]
    fn parse_plan_update() {
        let mut parser = CopilotParser::new();
        let line = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"plan","steps":[{"description":"Step 1","status":"pending"},{"description":"Step 2","status":"completed"}]}}}"#;
        let (events, _) = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("Plan:") && content.contains("Step 1")
        )));
    }

    #[test]
    fn parse_diff_content() {
        let mut parser = CopilotParser::new();

        // Start tool
        let start = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","kind":"edit","status":"pending"}}}"#;
        let _ = parser.feed(&format!("{start}\n"));

        // Complete with diff
        let complete = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"tc-1","status":"completed","content":{"type":"diff","path":"test.txt","diff":"+ new line"}}}}"#;
        let (events, _) = parser.feed(&format!("{complete}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Edit]") && meta.tool_name == "Edit"
        )));
    }

    #[test]
    fn skip_read_tool_output() {
        let mut parser = CopilotParser::new();

        // Start read tool
        let start = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","kind":"read","status":"pending"}}}"#;
        let _ = parser.feed(&format!("{start}\n"));

        // Complete with content (should be skipped)
        let complete = r#"{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"tc-1","status":"completed","rawOutput":{"content":"file contents here"}}}}"#;
        let (events, _) = parser.feed(&format!("{complete}\n"));

        // Should NOT emit the file contents
        assert!(events.is_empty());
    }

    #[test]
    fn kind_to_tool_name_mappings() {
        assert_eq!(kind_to_tool_name("execute", "Run"), "Bash");
        assert_eq!(kind_to_tool_name("edit", "Edit file"), "Edit");
        assert_eq!(kind_to_tool_name("read", "Read file"), "Read");
        assert_eq!(kind_to_tool_name("search", "Search"), "Grep");
        assert_eq!(kind_to_tool_name("fetch", "Fetch URL"), "WebFetch");
        assert_eq!(kind_to_tool_name("think", "Think"), "Think");
        assert_eq!(kind_to_tool_name("unknown", "Custom Tool"), "Custom Tool");
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = CopilotParser::new();

        // Send partial data
        let (events1, _) = parser.feed(r#"{"method":"session/"#);
        assert!(events1.is_empty());

        // Complete the line
        let (events2, _) = parser
            .feed(r#"update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hi"}}}}"#);
        assert!(events2.is_empty()); // Still no newline

        // Send newline
        let (events3, _) = parser.feed("\n");
        assert!(events3.iter().any(|e| matches!(e, AgentEvent::Text { .. })));
    }

    #[test]
    fn response_messages_ignored() {
        let mut parser = CopilotParser::new();
        let line = r#"{"id":1,"result":{"sessionId":"sess-123"}}"#;
        let (events, pending) = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
        assert!(pending.is_empty());
    }
}
