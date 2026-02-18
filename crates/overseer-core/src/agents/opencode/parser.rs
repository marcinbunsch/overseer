//! OpenCode response parser.
//!
//! Parses response parts from OpenCode's HTTP API into AgentEvents.
//!
//! # Different from Other Parsers
//!
//! OpenCode doesn't stream stdout — it uses HTTP API calls:
//!
//! 1. `session/create` — Create a session with permissions
//! 2. `session/prompt` — Send message, wait for complete response
//! 3. Parse response `parts` array into AgentEvents
//!
//! This parser handles step 3: converting the parts array to events.
//!
//! # Why No Streaming
//!
//! The TypeScript code uses synchronous API calls:
//! ```typescript
//! const response = await client.session.prompt({ ... })
//! this.processResponseParts(chatId, response.data.parts)
//! ```
//!
//! This means we get the full response at once, not incrementally.
//! The parser is simpler — just iterate over parts and emit events.

use crate::agents::event::{AgentEvent, ToolMeta};

use super::types::OpenCodePart;

/// Parser for OpenCode response parts.
///
/// # Simpler Design
///
/// Unlike streaming parsers, OpenCode returns complete responses.
/// This "parser" is really just a translator from parts to events.
/// No buffering needed since we get complete data.
#[derive(Debug, Default)]
pub struct OpenCodeParser {
    /// Session ID for this conversation.
    session_id: Option<String>,
}

impl OpenCodeParser {
    /// Create a new parser instance.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the session ID.
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// Set the session ID.
    pub fn set_session_id(&mut self, session_id: Option<String>) {
        self.session_id = session_id;
    }

    /// Parse response parts into AgentEvents.
    ///
    /// This is called once with the complete response, not incrementally.
    ///
    /// # Arguments
    ///
    /// * `parts` - The parts array from session/prompt response
    ///
    /// # Returns
    ///
    /// Vector of AgentEvents to emit to the UI
    pub fn parse_parts(&self, parts: &[OpenCodePart]) -> Vec<AgentEvent> {
        let mut events = Vec::new();

        for part in parts {
            events.extend(self.translate_part(part));
        }

        events
    }

    /// Translate a single part to AgentEvents.
    fn translate_part(&self, part: &OpenCodePart) -> Vec<AgentEvent> {
        match part.part_type.as_str() {
            // Text content
            "text" => {
                if let Some(ref text) = part.text {
                    if !text.is_empty() {
                        return vec![AgentEvent::Text { text: text.clone() }];
                    }
                }
                Vec::new()
            }

            // Tool invocation
            "tool-invocation" => {
                if let Some(ref tool) = part.tool {
                    let tool_name = normalize_tool_name(&tool.name);
                    let input = tool.input.clone().unwrap_or(serde_json::json!({}));
                    let input_str =
                        serde_json::to_string_pretty(&input).unwrap_or_else(|_| "{}".to_string());

                    let content = format!("{tool_name}\n{input_str}");

                    let mut events = vec![AgentEvent::Message {
                        content,
                        tool_meta: Some(ToolMeta {
                            tool_name: tool_name.clone(),
                            lines_added: None,
                            lines_removed: None,
                        }),
                        parent_tool_use_id: None,
                        tool_use_id: None,
                        is_info: None,
                    }];

                    // If tool has output and it's bash, emit as BashOutput
                    if tool_name == "Bash" {
                        if let Some(ref output) = tool.output {
                            let output_str = if let Some(s) = output.as_str() {
                                s.to_string()
                            } else {
                                serde_json::to_string(output).unwrap_or_default()
                            };
                            if !output_str.is_empty() {
                                events.push(AgentEvent::BashOutput { text: output_str });
                            }
                        }
                    }

                    return events;
                }
                Vec::new()
            }

            // Step lifecycle events — ignore
            "step-start" | "step-finish" => Vec::new(),

            // Unknown part type — ignore
            _ => Vec::new(),
        }
    }
}

/// Normalize OpenCode tool names to standard names.
fn normalize_tool_name(name: &str) -> String {
    match name.to_lowercase().as_str() {
        "bash" | "shell" => "Bash".to_string(),
        "write" => "Write".to_string(),
        "edit" => "Edit".to_string(),
        "read" => "Read".to_string(),
        "grep" | "search" => "Grep".to_string(),
        "glob" => "Glob".to_string(),
        "webfetch" | "fetch" => "WebFetch".to_string(),
        _ => {
            // Capitalize first letter
            let mut chars = name.chars();
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
    use crate::agents::opencode::types::ToolInfo;

    fn make_text_part(text: &str) -> OpenCodePart {
        OpenCodePart {
            id: None,
            session_id: None,
            message_id: None,
            part_type: "text".to_string(),
            text: Some(text.to_string()),
            tool: None,
            time: None,
        }
    }

    fn make_tool_part(name: &str, input: serde_json::Value) -> OpenCodePart {
        OpenCodePart {
            id: None,
            session_id: None,
            message_id: None,
            part_type: "tool-invocation".to_string(),
            text: None,
            tool: Some(ToolInfo {
                name: name.to_string(),
                input: Some(input),
                output: None,
            }),
            time: None,
        }
    }

    fn make_tool_part_with_output(
        name: &str,
        input: serde_json::Value,
        output: serde_json::Value,
    ) -> OpenCodePart {
        OpenCodePart {
            id: None,
            session_id: None,
            message_id: None,
            part_type: "tool-invocation".to_string(),
            text: None,
            tool: Some(ToolInfo {
                name: name.to_string(),
                input: Some(input),
                output: Some(output),
            }),
            time: None,
        }
    }

    #[test]
    fn new_parser_has_no_session_id() {
        let parser = OpenCodeParser::new();
        assert!(parser.session_id().is_none());
    }

    #[test]
    fn set_session_id() {
        let mut parser = OpenCodeParser::new();
        parser.set_session_id(Some("sess-123".to_string()));
        assert_eq!(parser.session_id(), Some("sess-123"));
    }

    #[test]
    fn parse_text_part() {
        let parser = OpenCodeParser::new();
        let parts = vec![make_text_part("Hello, world!")];
        let events = parser.parse_parts(&parts);

        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0],
            AgentEvent::Text { text } if text == "Hello, world!"
        ));
    }

    #[test]
    fn parse_empty_text_part() {
        let parser = OpenCodeParser::new();
        let parts = vec![make_text_part("")];
        let events = parser.parse_parts(&parts);

        assert!(events.is_empty());
    }

    #[test]
    fn parse_tool_invocation() {
        let parser = OpenCodeParser::new();
        let parts = vec![make_tool_part(
            "bash",
            serde_json::json!({"command": "ls -la"}),
        )];
        let events = parser.parse_parts(&parts);

        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Message { tool_meta: Some(meta), .. } if meta.tool_name == "Bash"
        )));
    }

    #[test]
    fn parse_bash_with_output() {
        let parser = OpenCodeParser::new();
        let parts = vec![make_tool_part_with_output(
            "bash",
            serde_json::json!({"command": "ls"}),
            serde_json::json!("file.txt\n"),
        )];
        let events = parser.parse_parts(&parts);

        // Should have both Message and BashOutput
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::Message { .. })));
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::BashOutput { text } if text.contains("file.txt")
        )));
    }

    #[test]
    fn parse_step_events_ignored() {
        let parser = OpenCodeParser::new();
        let parts = vec![
            OpenCodePart {
                id: Some("step-1".to_string()),
                session_id: None,
                message_id: None,
                part_type: "step-start".to_string(),
                text: None,
                tool: None,
                time: None,
            },
            OpenCodePart {
                id: Some("step-1".to_string()),
                session_id: None,
                message_id: None,
                part_type: "step-finish".to_string(),
                text: None,
                tool: None,
                time: None,
            },
        ];
        let events = parser.parse_parts(&parts);

        assert!(events.is_empty());
    }

    #[test]
    fn parse_multiple_parts() {
        let parser = OpenCodeParser::new();
        let parts = vec![
            make_text_part("Here's the result:"),
            make_tool_part("bash", serde_json::json!({"command": "echo hi"})),
            make_text_part("Done!"),
        ];
        let events = parser.parse_parts(&parts);

        // Should have 3 events: Text, Message, Text
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn normalize_tool_names_test() {
        assert_eq!(normalize_tool_name("bash"), "Bash");
        assert_eq!(normalize_tool_name("shell"), "Bash");
        assert_eq!(normalize_tool_name("write"), "Write");
        assert_eq!(normalize_tool_name("edit"), "Edit");
        assert_eq!(normalize_tool_name("read"), "Read");
        assert_eq!(normalize_tool_name("grep"), "Grep");
        assert_eq!(normalize_tool_name("search"), "Grep");
        assert_eq!(normalize_tool_name("glob"), "Glob");
        assert_eq!(normalize_tool_name("webfetch"), "WebFetch");
        assert_eq!(normalize_tool_name("custom_tool"), "Custom_tool");
    }
}
