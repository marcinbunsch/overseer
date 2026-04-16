//! Pi RPC stream parser.
//!
//! Parses JSONL output from Pi's RPC mode and emits AgentEvents.
//!
//! # Pi RPC Architecture
//!
//! - **Persistent process**: One `pi --mode rpc` process per chat
//! - **Commands on stdin**: JSON commands like `{"type": "prompt", "message": "..."}`
//! - **Events on stdout**: JSONL events streamed as they occur
//! - **No tool approvals**: Tools execute freely
//!
//! # Event Flow
//!
//! When a prompt is sent:
//! 1. `response` (command ack) — confirms prompt was received
//! 2. `agent_start` — agent begins processing
//! 3. `turn_start` — new turn begins
//! 4. `message_start` — assistant message begins
//! 5. `message_update` (repeated) — streaming text chunks
//! 6. `message_end` — assistant message complete
//! 7. `tool_execution_start` → `tool_execution_end` — if tools are used
//! 8. `turn_end` — turn complete with final message
//! 9. `agent_end` — agent done processing

use crate::agents::event::{AgentEvent, ToolMeta};

/// Parser for Pi RPC JSONL output.
#[derive(Debug, Default)]
pub struct PiParser {
    /// Buffer for incomplete lines.
    buffer: String,

    /// Last tool name for filtering output.
    last_tool_name: Option<String>,
}

impl PiParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed data to the parser and collect emitted events.
    pub fn feed(&mut self, data: &str) -> Vec<AgentEvent> {
        let mut events = Vec::new();

        self.buffer.push_str(data);
        let buffer = std::mem::take(&mut self.buffer);
        let mut lines: Vec<&str> = buffer.split('\n').collect();

        // Keep last incomplete line in buffer
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

    /// Parse a single JSONL line.
    fn parse_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };

        let event_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            // Command acknowledgment — ignore (we don't need to surface these)
            "response" => Vec::new(),

            // Agent lifecycle
            "agent_start" => Vec::new(), // No-op, internal
            "agent_end" => vec![AgentEvent::Done],

            // Turn lifecycle
            "turn_start" => Vec::new(), // No-op, internal
            "turn_end" => vec![AgentEvent::TurnComplete],

            // Assistant message streaming
            "message_start" | "message_end" => Vec::new(), // Bookends, content comes via message_update

            "message_update" => self.handle_message_update(&value),

            // Tool execution
            "tool_execution_start" => self.handle_tool_start(&value),
            "tool_execution_update" => Vec::new(), // Partial results, skip for now
            "tool_execution_end" => self.handle_tool_end(&value),

            // Session events
            "compaction_start" | "compaction_end" => Vec::new(),
            "auto_retry_start" | "auto_retry_end" => Vec::new(),
            "queue_update" => Vec::new(),

            // Unknown — ignore gracefully
            _ => Vec::new(),
        }
    }

    /// Handle a message_update event.
    ///
    /// Pi's message_update wraps an `assistantMessageEvent` that signals streaming
    /// deltas for either text or thinking content. The subtypes follow a
    /// start / delta / end pattern:
    ///
    /// - `text_delta` carries incremental text chunks in `delta`.
    /// - `text_start` / `text_end` are bookends (`text_end.content` has the full
    ///   final text — we ignore it to avoid duplicating already-streamed chunks).
    /// - `thinking_*` events are reasoning traces — skipped.
    fn handle_message_update(&mut self, value: &serde_json::Value) -> Vec<AgentEvent> {
        let Some(event) = value.get("assistantMessageEvent") else {
            return Vec::new();
        };
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if event_type == "text_delta" {
            if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    return vec![AgentEvent::Text {
                        text: delta.to_string(),
                    }];
                }
            }
        }

        Vec::new()
    }

    /// Handle tool_execution_start event.
    fn handle_tool_start(&mut self, value: &serde_json::Value) -> Vec<AgentEvent> {
        let tool_name = value
            .get("toolName")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let normalized = normalize_tool_name(tool_name);
        self.last_tool_name = Some(normalized.clone());

        let args = value.get("args").cloned().unwrap_or(serde_json::json!({}));
        let input_str = serde_json::to_string_pretty(&args).unwrap_or_default();

        // Calculate line changes for Edit/Write tools
        let tool_meta = if normalized == "Edit" || normalized == "Write" {
            let old_str = args
                .get("old_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let new_str = args
                .get("new_string")
                .or_else(|| args.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            Some(ToolMeta {
                tool_name: normalized.clone(),
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
                tool_name: normalized.clone(),
                lines_added: None,
                lines_removed: None,
            })
        };

        let content = if input_str.is_empty() || input_str == "{}" {
            format!("[{normalized}]")
        } else {
            format!("[{normalized}]\n{input_str}")
        };

        vec![AgentEvent::Message {
            content,
            tool_meta,
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: None,
        }]
    }

    /// Handle tool_execution_end event.
    fn handle_tool_end(&mut self, value: &serde_json::Value) -> Vec<AgentEvent> {
        let is_error = value.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);

        // Skip Read tool output (file contents are noisy)
        if self.last_tool_name.as_deref() == Some("Read") {
            self.last_tool_name = None;
            return Vec::new();
        }

        self.last_tool_name = None;

        // Extract result content
        if let Some(result) = value.get("result") {
            if let Some(content_arr) = result.get("content").and_then(|v| v.as_array()) {
                let text: String = content_arr
                    .iter()
                    .filter_map(|item| {
                        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                            item.get("text").and_then(|t| t.as_str())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<&str>>()
                    .join("\n");

                if !text.is_empty() {
                    if is_error {
                        return vec![AgentEvent::Message {
                            content: format!("Error: {text}"),
                            tool_meta: None,
                            parent_tool_use_id: None,
                            tool_use_id: None,
                            is_info: None,
                        }];
                    } else {
                        return vec![AgentEvent::BashOutput { text }];
                    }
                }
            }
        }

        Vec::new()
    }
}

/// Normalize Pi tool names to standard Overseer names.
fn normalize_tool_name(pi_name: &str) -> String {
    match pi_name.to_lowercase().as_str() {
        "bash" | "shell" | "run_shell_command" => "Bash".to_string(),
        "write" | "write_file" => "Write".to_string(),
        "edit" | "edit_file" => "Edit".to_string(),
        "read" | "read_file" => "Read".to_string(),
        "grep" | "search" => "Grep".to_string(),
        "glob" | "find" => "Glob".to_string(),
        "webfetch" | "web_fetch" | "fetch" => "WebFetch".to_string(),
        _ => {
            // Capitalize first letter
            let mut chars = pi_name.chars();
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
    fn new_parser_is_empty() {
        let parser = PiParser::new();
        assert!(parser.buffer.is_empty());
    }

    #[test]
    fn parse_empty_line() {
        let mut parser = PiParser::new();
        let events = parser.feed("\n");
        assert!(events.is_empty());
    }

    #[test]
    fn parse_invalid_json() {
        let mut parser = PiParser::new();
        let events = parser.feed("not json\n");
        assert!(events.is_empty());
    }

    #[test]
    fn parse_response_ignored() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"response","command":"prompt","success":true}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events.is_empty());
    }

    #[test]
    fn parse_agent_end_emits_done() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"agent_end","messages":[]}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events.iter().any(|e| matches!(e, AgentEvent::Done)));
    }

    #[test]
    fn parse_turn_end_emits_turn_complete() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"turn_end","message":{},"toolResults":[]}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnComplete)));
    }

    #[test]
    fn parse_message_update_text_delta() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":1,"delta":"Hello world"}}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events.iter().any(
            |e| matches!(e, AgentEvent::Text { text } if text == "Hello world")
        ));
    }

    #[test]
    fn parse_message_update_text_start_end_ignored() {
        let mut parser = PiParser::new();
        let start = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_start","contentIndex":1}}"#;
        let end = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":1,"content":"Full text"}}"#;
        assert!(parser.feed(&format!("{start}\n")).is_empty());
        assert!(parser.feed(&format!("{end}\n")).is_empty());
    }

    #[test]
    fn parse_message_update_thinking_ignored() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"hmm"}}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events.is_empty());
    }

    #[test]
    fn parse_tool_execution_start_bash() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"tool_execution_start","toolCallId":"tc-1","toolName":"bash","args":{"command":"ls -la"}}"#;
        let events = parser.feed(&format!("{line}\n"));
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, tool_meta: Some(meta), .. }
            if content.contains("[Bash]") && meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_tool_execution_start_edit_with_line_counts() {
        let mut parser = PiParser::new();
        let line = r#"{"type":"tool_execution_start","toolCallId":"tc-2","toolName":"edit","args":{"old_string":"old","new_string":"new\nline"}}"#;
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
    fn parse_tool_execution_end_success() {
        let mut parser = PiParser::new();

        // Start a bash tool first
        let start = r#"{"type":"tool_execution_start","toolCallId":"tc-1","toolName":"bash","args":{}}"#;
        let _ = parser.feed(&format!("{start}\n"));

        // End with result
        let end = r#"{"type":"tool_execution_end","toolCallId":"tc-1","toolName":"bash","result":{"content":[{"type":"text","text":"file.txt"}]},"isError":false}"#;
        let events = parser.feed(&format!("{end}\n"));

        assert!(events.iter().any(
            |e| matches!(e, AgentEvent::BashOutput { text } if text == "file.txt")
        ));
    }

    #[test]
    fn parse_tool_execution_end_error() {
        let mut parser = PiParser::new();

        let end = r#"{"type":"tool_execution_end","toolCallId":"tc-1","toolName":"bash","result":{"content":[{"type":"text","text":"command not found"}]},"isError":true}"#;
        let events = parser.feed(&format!("{end}\n"));

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { content, .. } if content.contains("command not found")
        )));
    }

    #[test]
    fn skip_read_tool_output() {
        let mut parser = PiParser::new();

        // Start read tool
        let start = r#"{"type":"tool_execution_start","toolCallId":"tc-1","toolName":"read","args":{"path":"test.txt"}}"#;
        let _ = parser.feed(&format!("{start}\n"));

        // End should be skipped
        let end = r#"{"type":"tool_execution_end","toolCallId":"tc-1","toolName":"read","result":{"content":[{"type":"text","text":"file contents"}]},"isError":false}"#;
        let events = parser.feed(&format!("{end}\n"));
        assert!(events.is_empty());
    }

    #[test]
    fn normalize_tool_names() {
        assert_eq!(normalize_tool_name("bash"), "Bash");
        assert_eq!(normalize_tool_name("write"), "Write");
        assert_eq!(normalize_tool_name("edit"), "Edit");
        assert_eq!(normalize_tool_name("read"), "Read");
        assert_eq!(normalize_tool_name("grep"), "Grep");
        assert_eq!(normalize_tool_name("glob"), "Glob");
        assert_eq!(normalize_tool_name("webfetch"), "WebFetch");
        assert_eq!(normalize_tool_name("custom_tool"), "Custom_tool");
    }

    #[test]
    fn buffering_handles_partial_lines() {
        let mut parser = PiParser::new();

        let events1 = parser.feed(r#"{"type":"message_update","#);
        assert!(events1.is_empty());

        let events2 =
            parser.feed(r#""assistantMessageEvent":{"type":"text_delta","delta":"Hi"}}"#);
        assert!(events2.is_empty()); // Still no newline

        let events3 = parser.feed("\n");
        assert!(events3
            .iter()
            .any(|e| matches!(e, AgentEvent::Text { .. })));
    }

    #[test]
    fn flush_processes_remaining_buffer() {
        let mut parser = PiParser::new();
        parser.feed(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Final"}}"#,
        );

        let events = parser.flush();
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::Text { .. })));
    }
}
