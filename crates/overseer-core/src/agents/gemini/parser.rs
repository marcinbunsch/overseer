//! Gemini stream parser.
//!
//! Parses NDJSON output from Gemini CLI and emits AgentEvents.
//!
//! # Gemini Architecture
//!
//! Unlike Claude/Codex/Copilot which maintain persistent servers:
//! - **One-shot model**: New process spawned per message
//! - **Session continuity**: Via `--resume <session-id>` flag
//! - **No tool approvals**: Uses `--approval-mode yolo` or `auto_edit`
//! - **Simple streaming**: NDJSON events, no JSON-RPC complexity
//!
//! # Rate Limiting
//!
//! Gemini has aggressive rate limits. The TypeScript code includes:
//! - Circuit breaker after 10 consecutive rate limit retries
//! - Detection of "death spiral" loops
//!
//! This parser doesn't handle rate limiting directly (that's stderr),
//! but we track state that helps the caller manage it.

use crate::agents::event::{AgentEvent, ToolMeta};

use super::types::GeminiStreamEvent;

/// Parser state for a Gemini conversation.
///
/// # Simpler than Other Parsers
///
/// Gemini's one-shot model means:
/// - No pending request tracking (no JSON-RPC)
/// - No tool call state tracking (auto-approved)
/// - Just session ID and buffering
#[derive(Debug, Default)]
pub struct GeminiParser {
    /// Session ID for resumption.
    session_id: Option<String>,

    /// Buffer for incomplete lines.
    buffer: String,

    /// Last tool name (for filtering Read output).
    last_tool_name: Option<String>,

    /// Track if last message was info (rate limit warning).
    ///
    /// Used by caller to decide whether to start new message
    /// or append to existing one after rate limit clears.
    last_was_info: bool,
}

impl GeminiParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the session ID if one has been received.
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Set the session ID (for resuming sessions).
    pub fn set_session_id(&mut self, session_id: Option<String>) {
        self.session_id = session_id;
    }

    /// Check if the last emitted message was an info message.
    ///
    /// Used by callers to handle rate limit recovery gracefully.
    pub fn last_was_info(&self) -> bool {
        self.last_was_info
    }

    /// Reset the last_was_info flag (after handling).
    pub fn clear_last_was_info(&mut self) {
        self.last_was_info = false;
    }

    /// Feed data to the parser and collect emitted events.
    ///
    /// Unlike Codex/Copilot, returns only events (no pending requests
    /// since Gemini doesn't support interactive tool approvals).
    pub fn feed(&mut self, data: &str) -> Vec<AgentEvent> {
        let mut events = Vec::new();

        self.buffer.push_str(data);
        let buffer = std::mem::take(&mut self.buffer);
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        if let Some(incomplete) = lines.pop() {
            self.buffer = incomplete.to_string();
        }

        for line in lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                events.extend(self.parse_line(trimmed));
            }
        }

        events
    }

    /// Flush any remaining buffered content.
    pub fn flush(&mut self) -> Vec<AgentEvent> {
        let remaining = std::mem::take(&mut self.buffer);
        let trimmed = remaining.trim();
        if !trimmed.is_empty() {
            self.parse_line(trimmed)
        } else {
            Vec::new()
        }
    }

    /// Parse a single line of NDJSON.
    fn parse_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let event: GeminiStreamEvent = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        self.translate_event(&event)
    }

    /// Translate a Gemini event into AgentEvents.
    fn translate_event(&mut self, event: &GeminiStreamEvent) -> Vec<AgentEvent> {
        // Reset last_was_info on any successful event
        // (This helps detect when rate limiting has cleared)
        self.last_was_info = false;

        match event.event_type.as_str() {
            // Session initialization
            "init" => {
                let mut events = Vec::new();

                if let Some(ref session_id) = event.session_id {
                    self.session_id = Some(session_id.clone());
                    events.push(AgentEvent::SessionId {
                        session_id: session_id.clone(),
                    });
                }

                events
            }

            // Text message from assistant
            "message" => {
                // Only handle assistant messages
                if event.role.as_deref() != Some("assistant") {
                    return Vec::new();
                }

                if let Some(ref content) = event.content {
                    // Delta = streaming chunk, otherwise complete message
                    if event.delta == Some(true) {
                        return vec![AgentEvent::Text {
                            text: content.clone(),
                        }];
                    } else {
                        return vec![AgentEvent::Message {
                            content: content.clone(),
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }];
                    }
                }

                Vec::new()
            }

            // Tool invocation
            "tool_use" => {
                if let Some(ref tool_name) = event.tool_name {
                    let normalized_name = normalize_tool_name(tool_name);

                    // Track tool name for output filtering
                    self.last_tool_name = Some(normalized_name.clone());

                    let params = event.parameters.clone().unwrap_or(serde_json::json!({}));
                    let input_str = serde_json::to_string_pretty(&params).unwrap_or_default();

                    // Calculate line changes for Edit/Write tools
                    let tool_meta = if normalized_name == "Edit" || normalized_name == "Write" {
                        let old_str = params
                            .get("old_string")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let new_str = params
                            .get("new_string")
                            .or_else(|| params.get("content"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        Some(ToolMeta {
                            tool_name: normalized_name.clone(),
                            lines_added: Some(if new_str.is_empty() {
                                0
                            } else {
                                new_str.split('\n').count() as u32
                            }),
                            lines_removed: Some(if old_str.is_empty() {
                                0
                            } else {
                                old_str.split('\n').count() as u32
                            }),
                        })
                    } else {
                        Some(ToolMeta {
                            tool_name: normalized_name.clone(),
                            lines_added: None,
                            lines_removed: None,
                        })
                    };

                    let content = if input_str.is_empty() || input_str == "{}" {
                        format!("[{normalized_name}]")
                    } else {
                        format!("[{normalized_name}]\n{input_str}")
                    };

                    return vec![AgentEvent::Message {
                        content,
                        tool_meta,
                        parent_tool_use_id: None,
                        tool_use_id: None,
                        is_info: None,
                    }];
                }

                Vec::new()
            }

            // Tool result
            "tool_result" => {
                // Skip Read tool output (file contents)
                if self.last_tool_name.as_deref() == Some("Read") {
                    self.last_tool_name = None;
                    return Vec::new();
                }

                // Reset last tool name
                self.last_tool_name = None;

                if event.status.as_deref() == Some("success") {
                    if let Some(ref output) = event.output {
                        return vec![AgentEvent::BashOutput {
                            text: output.clone(),
                        }];
                    }
                } else if event.status.as_deref() == Some("error") {
                    if let Some(ref error) = event.error {
                        return vec![AgentEvent::Message {
                            content: format!("Error: {error}"),
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }];
                    }
                }

                Vec::new()
            }

            // Error event
            "error" => {
                if let Some(ref message) = event.message {
                    return vec![AgentEvent::Message {
                        content: format!("Error: {message}"),
                        tool_meta: None,
                        parent_tool_use_id: None,
                        tool_use_id: None,
                        is_info: None,
                    }];
                }

                Vec::new()
            }

            // Final result event
            "result" => {
                // The TypeScript code emits TurnComplete in the close handler,
                // not here. We'll match that behavior and not emit here.
                // The caller should emit TurnComplete when the process exits.
                Vec::new()
            }

            // Unknown event type — ignore
            _ => Vec::new(),
        }
    }

    /// Mark that an info message was emitted (e.g., rate limit warning).
    ///
    /// This is called by the caller when they emit an info message
    /// from stderr handling.
    pub fn mark_info_message(&mut self) {
        self.last_was_info = true;
    }
}

/// Normalize Gemini tool names to standard names.
///
/// Gemini CLI uses different names than our standard:
/// - "shell" or "run_shell_command" → "Bash"
/// - "write_file" → "Write"
/// - "edit_file" → "Edit"
/// - "read_file" → "Read"
fn normalize_tool_name(gemini_name: &str) -> String {
    match gemini_name.to_lowercase().as_str() {
        "shell" | "run_shell_command" => "Bash".to_string(),
        "write_file" => "Write".to_string(),
        "edit_file" => "Edit".to_string(),
        "read_file" => "Read".to_string(),
        "search" | "grep" => "Grep".to_string(),
        "fetch" | "web_fetch" => "WebFetch".to_string(),
        "list_directory" => "ListDir".to_string(),
        _ => {
            // Capitalize first letter
            let mut chars = gemini_name.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
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
    fn new_parser_has_no_session_id() {
        let parser = GeminiParser::new();
        assert!(parser.session_id().is_none());
    }

    #[test]
    fn set_session_id() {
        let mut parser = GeminiParser::new();
        parser.set_session_id(Some("sess-123".to_string()));
        assert_eq!(parser.session_id(), Some("sess-123"));
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = GeminiParser::new();
        let events = parser.feed("\n");
        assert!(events.is_empty());
    }

    #[test]
    fn parse_invalid_json() {
        let mut parser = GeminiParser::new();
        let events = parser.feed("not json\n");
        assert!(events.is_empty());
    }

    #[test]
    fn parse_init_event() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"init","session_id":"sess-456","model":"gemini-pro"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::SessionId { session_id } if session_id == "sess-456"
        )));
        assert_eq!(parser.session_id(), Some("sess-456"));
    }

    #[test]
    fn parse_message_delta() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"message","role":"assistant","content":"Hello","delta":true}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Text { text } if text == "Hello"
        )));
    }

    #[test]
    fn parse_message_complete() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"message","role":"assistant","content":"Complete message"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content == "Complete message"
        )));
    }

    #[test]
    fn parse_message_ignores_user_role() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"message","role":"user","content":"User message"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.is_empty());
    }

    #[test]
    fn parse_tool_use_shell() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"tool_use","tool_name":"shell","parameters":{"command":"ls -la"}}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Bash]") && meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_tool_use_edit() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"tool_use","tool_name":"edit_file","parameters":{"path":"test.txt","old_string":"old","new_string":"new\nline"}}"#;
        let events = parser.feed(&format!("{line}\n"));

        let event = events.iter().find(|e| {
            matches!(e, AgentEvent::Message { tool_meta: Some(meta), .. } if meta.tool_name == "Edit")
        });
        assert!(event.is_some());

        if let Some(AgentEvent::Message {
            tool_meta: Some(meta),
            ..
        }) = event
        {
            assert_eq!(meta.lines_added, Some(2));
            assert_eq!(meta.lines_removed, Some(1));
        }
    }

    #[test]
    fn parse_tool_result_success() {
        let mut parser = GeminiParser::new();

        // First, a tool_use to set last_tool_name
        let tool_use = r#"{"type":"tool_use","tool_name":"shell","parameters":{}}"#;
        let _ = parser.feed(&format!("{tool_use}\n"));

        // Then the result
        let result = r#"{"type":"tool_result","status":"success","output":"file.txt\n"}"#;
        let events = parser.feed(&format!("{result}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::BashOutput { text } if text == "file.txt\n"
        )));
    }

    #[test]
    fn parse_tool_result_error() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"tool_result","status":"error","error":"Command failed"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("Command failed")
        )));
    }

    #[test]
    fn skip_read_tool_output() {
        let mut parser = GeminiParser::new();

        // Start read tool
        let tool_use =
            r#"{"type":"tool_use","tool_name":"read_file","parameters":{"path":"test.txt"}}"#;
        let _ = parser.feed(&format!("{tool_use}\n"));

        // Result should be skipped
        let result = r#"{"type":"tool_result","status":"success","output":"file contents here"}"#;
        let events = parser.feed(&format!("{result}\n"));

        // Should NOT emit the file contents
        assert!(events.is_empty());
    }

    #[test]
    fn parse_error_event() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"error","message":"Something went wrong"}"#;
        let events = parser.feed(&format!("{line}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("Something went wrong")
        )));
    }

    #[test]
    fn result_event_no_turn_complete() {
        let mut parser = GeminiParser::new();
        let line = r#"{"type":"result","success":true}"#;
        let events = parser.feed(&format!("{line}\n"));

        // Result event should not emit TurnComplete (caller handles that)
        assert!(events.is_empty());
    }

    #[test]
    fn normalize_tool_names() {
        assert_eq!(normalize_tool_name("shell"), "Bash");
        assert_eq!(normalize_tool_name("run_shell_command"), "Bash");
        assert_eq!(normalize_tool_name("write_file"), "Write");
        assert_eq!(normalize_tool_name("edit_file"), "Edit");
        assert_eq!(normalize_tool_name("read_file"), "Read");
        assert_eq!(normalize_tool_name("search"), "Grep");
        assert_eq!(normalize_tool_name("grep"), "Grep");
        assert_eq!(normalize_tool_name("fetch"), "WebFetch");
        assert_eq!(normalize_tool_name("list_directory"), "ListDir");
        assert_eq!(normalize_tool_name("custom_tool"), "Custom_tool");
    }

    #[test]
    fn last_was_info_tracking() {
        let mut parser = GeminiParser::new();
        assert!(!parser.last_was_info());

        parser.mark_info_message();
        assert!(parser.last_was_info());

        // Any event should clear it
        let line = r#"{"type":"message","role":"assistant","content":"Hi","delta":true}"#;
        let _ = parser.feed(&format!("{line}\n"));
        assert!(!parser.last_was_info());
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = GeminiParser::new();

        // Send partial data
        let events1 = parser.feed(r#"{"type":"message","role":"assistant","#);
        assert!(events1.is_empty());

        // Complete the line
        let events2 = parser.feed(r#""content":"Hi","delta":true}"#);
        assert!(events2.is_empty()); // Still no newline

        // Send newline
        let events3 = parser.feed("\n");
        assert!(events3.iter().any(|e| matches!(e, AgentEvent::Text { .. })));
    }

    #[test]
    fn flush_processes_remaining_buffer() {
        let mut parser = GeminiParser::new();

        // Send data without trailing newline
        parser.feed(r#"{"type":"message","role":"assistant","content":"Final","delta":true}"#);

        // Flush should process it
        let events = parser.flush();
        assert!(events.iter().any(|e| matches!(e, AgentEvent::Text { .. })));
    }
}
