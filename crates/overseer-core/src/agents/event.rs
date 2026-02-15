//! Unified event type for all agent backends.

use serde::{Deserialize, Serialize};

/// Metadata about a tool operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolMeta {
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_added: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_removed: Option<u32>,
}

/// A single question item in a multi-question request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionItem {
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    #[serde(default)]
    pub multi_select: bool,
}

/// An option for a question.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

/// Unified event type emitted by all agent backends.
///
/// This is the core abstraction that allows the frontend to handle
/// different agents (Claude, Codex, Copilot, etc.) uniformly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentEvent {
    // === Streaming content ===
    /// Raw text output (streaming).
    Text { text: String },

    /// Bash command output (for display in terminal-style).
    BashOutput { text: String },

    // === Tool-related (messages from agent) ===
    /// A message from the agent, possibly with tool metadata.
    Message {
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_meta: Option<ToolMeta>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_use_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_info: Option<bool>,
    },

    /// Result of a tool execution.
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(default)]
        is_error: bool,
    },

    // === Approval requests (agent asking for permission) ===
    /// Agent needs approval to run a tool.
    ToolApproval {
        /// Request ID for responding back to the agent.
        request_id: String,
        /// Tool name (e.g., "Bash", "Edit", "Write").
        name: String,
        /// Full tool input as JSON.
        input: serde_json::Value,
        /// Human-readable input display.
        display_input: String,
        /// Extracted command prefixes for bash commands.
        #[serde(skip_serializing_if = "Option::is_none")]
        prefixes: Option<Vec<String>>,
    },

    /// Agent is asking the user a question.
    Question {
        request_id: String,
        questions: Vec<QuestionItem>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_input: Option<serde_json::Value>,
    },

    /// Agent wants user to approve a plan.
    PlanApproval { request_id: String, content: String },

    // === Session lifecycle ===
    /// Agent reported its session ID.
    SessionId { session_id: String },

    /// A turn (user message + agent response) completed.
    TurnComplete,

    /// Agent process exited.
    Done,

    /// An error occurred.
    Error { message: String },

    // === Overseer-specific ===
    /// An Overseer action was extracted from agent output.
    OverseerAction {
        action: crate::overseer_actions::OverseerAction,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overseer_actions::OverseerAction;
    use serde_json::json;

    mod serialization {
        use super::*;

        #[test]
        fn text_event_roundtrip() {
            let event = AgentEvent::Text {
                text: "Hello, world!".to_string(),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::Text { text } => assert_eq!(text, "Hello, world!"),
                _ => panic!("Expected Text event"),
            }
        }

        #[test]
        fn bash_output_event_roundtrip() {
            let event = AgentEvent::BashOutput {
                text: "$ ls\nfile.txt".to_string(),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::BashOutput { text } => assert_eq!(text, "$ ls\nfile.txt"),
                _ => panic!("Expected BashOutput event"),
            }
        }

        #[test]
        fn message_event_minimal() {
            let event = AgentEvent::Message {
                content: "I'll help you with that.".to_string(),
                tool_meta: None,
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            };

            let json = serde_json::to_string(&event).unwrap();
            assert!(!json.contains("toolMeta")); // Skip serializing None fields
            assert!(!json.contains("parentToolUseId"));

            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();
            match parsed {
                AgentEvent::Message {
                    content, tool_meta, ..
                } => {
                    assert_eq!(content, "I'll help you with that.");
                    assert!(tool_meta.is_none());
                }
                _ => panic!("Expected Message event"),
            }
        }

        #[test]
        fn message_event_with_tool_meta() {
            let event = AgentEvent::Message {
                content: "Edit complete.".to_string(),
                tool_meta: Some(ToolMeta {
                    tool_name: "Edit".to_string(),
                    lines_added: Some(5),
                    lines_removed: Some(2),
                }),
                parent_tool_use_id: Some("parent-123".to_string()),
                tool_use_id: Some("tool-456".to_string()),
                is_info: Some(false),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::Message {
                    content,
                    tool_meta,
                    parent_tool_use_id,
                    tool_use_id,
                    is_info,
                } => {
                    assert_eq!(content, "Edit complete.");
                    let meta = tool_meta.unwrap();
                    assert_eq!(meta.tool_name, "Edit");
                    assert_eq!(meta.lines_added, Some(5));
                    assert_eq!(meta.lines_removed, Some(2));
                    assert_eq!(parent_tool_use_id, Some("parent-123".to_string()));
                    assert_eq!(tool_use_id, Some("tool-456".to_string()));
                    assert_eq!(is_info, Some(false));
                }
                _ => panic!("Expected Message event"),
            }
        }

        #[test]
        fn tool_result_event() {
            let event = AgentEvent::ToolResult {
                tool_use_id: "tool-123".to_string(),
                content: "File created successfully".to_string(),
                is_error: false,
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => {
                    assert_eq!(tool_use_id, "tool-123");
                    assert_eq!(content, "File created successfully");
                    assert!(!is_error);
                }
                _ => panic!("Expected ToolResult event"),
            }
        }

        #[test]
        fn tool_result_with_error() {
            let event = AgentEvent::ToolResult {
                tool_use_id: "tool-456".to_string(),
                content: "Permission denied".to_string(),
                is_error: true,
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::ToolResult { is_error, .. } => assert!(is_error),
                _ => panic!("Expected ToolResult event"),
            }
        }

        #[test]
        fn tool_approval_event() {
            let event = AgentEvent::ToolApproval {
                request_id: "req-123".to_string(),
                name: "Bash".to_string(),
                input: json!({"command": "rm -rf /tmp/test"}),
                display_input: "rm -rf /tmp/test".to_string(),
                prefixes: Some(vec!["rm".to_string()]),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::ToolApproval {
                    request_id,
                    name,
                    input,
                    display_input,
                    prefixes,
                } => {
                    assert_eq!(request_id, "req-123");
                    assert_eq!(name, "Bash");
                    assert_eq!(input["command"], "rm -rf /tmp/test");
                    assert_eq!(display_input, "rm -rf /tmp/test");
                    assert_eq!(prefixes, Some(vec!["rm".to_string()]));
                }
                _ => panic!("Expected ToolApproval event"),
            }
        }

        #[test]
        fn question_event() {
            let event = AgentEvent::Question {
                request_id: "req-456".to_string(),
                questions: vec![QuestionItem {
                    question: "Which framework?".to_string(),
                    header: "Framework".to_string(),
                    options: vec![
                        QuestionOption {
                            label: "React".to_string(),
                            description: "Popular UI library".to_string(),
                        },
                        QuestionOption {
                            label: "Vue".to_string(),
                            description: "Progressive framework".to_string(),
                        },
                    ],
                    multi_select: false,
                }],
                raw_input: None,
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::Question {
                    request_id,
                    questions,
                    ..
                } => {
                    assert_eq!(request_id, "req-456");
                    assert_eq!(questions.len(), 1);
                    assert_eq!(questions[0].question, "Which framework?");
                    assert_eq!(questions[0].options.len(), 2);
                    assert!(!questions[0].multi_select);
                }
                _ => panic!("Expected Question event"),
            }
        }

        #[test]
        fn plan_approval_event() {
            let event = AgentEvent::PlanApproval {
                request_id: "req-789".to_string(),
                content: "1. Create component\n2. Add tests\n3. Update docs".to_string(),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::PlanApproval {
                    request_id,
                    content,
                } => {
                    assert_eq!(request_id, "req-789");
                    assert!(content.contains("Create component"));
                }
                _ => panic!("Expected PlanApproval event"),
            }
        }

        #[test]
        fn session_id_event() {
            let event = AgentEvent::SessionId {
                session_id: "sess-abc123".to_string(),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::SessionId { session_id } => assert_eq!(session_id, "sess-abc123"),
                _ => panic!("Expected SessionId event"),
            }
        }

        #[test]
        fn turn_complete_event() {
            let event = AgentEvent::TurnComplete;

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            assert!(matches!(parsed, AgentEvent::TurnComplete));
        }

        #[test]
        fn done_event() {
            let event = AgentEvent::Done;

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            assert!(matches!(parsed, AgentEvent::Done));
        }

        #[test]
        fn error_event() {
            let event = AgentEvent::Error {
                message: "Connection lost".to_string(),
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::Error { message } => assert_eq!(message, "Connection lost"),
                _ => panic!("Expected Error event"),
            }
        }

        #[test]
        fn overseer_action_event() {
            use crate::overseer_actions::RenameChatParams;

            let event = AgentEvent::OverseerAction {
                action: OverseerAction::RenameChat {
                    params: RenameChatParams {
                        title: "New Chat Title".to_string(),
                    },
                },
            };

            let json = serde_json::to_string(&event).unwrap();
            let parsed: AgentEvent = serde_json::from_str(&json).unwrap();

            match parsed {
                AgentEvent::OverseerAction { action } => match action {
                    OverseerAction::RenameChat { params } => {
                        assert_eq!(params.title, "New Chat Title")
                    }
                    _ => panic!("Expected RenameChat action"),
                },
                _ => panic!("Expected OverseerAction event"),
            }
        }
    }

    mod json_format {
        use super::*;

        #[test]
        fn uses_camel_case_tag() {
            let event = AgentEvent::TurnComplete;
            let json = serde_json::to_string(&event).unwrap();
            // Should be "kind":"turnComplete" not "kind":"turn_complete"
            assert!(json.contains("turnComplete"));
        }

        #[test]
        fn uses_snake_case_fields() {
            // Note: The enum's rename_all only affects the tag ("kind"),
            // not the variant field names. Field names use snake_case by default.
            // This can be changed if needed for TypeScript compatibility.
            let event = AgentEvent::Message {
                content: "test".to_string(),
                tool_meta: None,
                parent_tool_use_id: Some("id".to_string()),
                tool_use_id: None,
                is_info: None,
            };
            let json = serde_json::to_string(&event).unwrap();
            // Currently uses snake_case field names
            assert!(json.contains("parent_tool_use_id"));
        }

        #[test]
        fn bash_output_has_correct_tag() {
            let event = AgentEvent::BashOutput {
                text: "output".to_string(),
            };
            let json = serde_json::to_string(&event).unwrap();
            assert!(json.contains("bashOutput"));
        }

        #[test]
        fn tool_approval_has_correct_tag() {
            let event = AgentEvent::ToolApproval {
                request_id: "req".to_string(),
                name: "test".to_string(),
                input: json!({}),
                display_input: "test".to_string(),
                prefixes: None,
            };
            let json = serde_json::to_string(&event).unwrap();
            assert!(json.contains("toolApproval"));
        }
    }

    mod tool_meta {
        use super::*;

        #[test]
        fn serialization_skips_none_fields() {
            let meta = ToolMeta {
                tool_name: "Read".to_string(),
                lines_added: None,
                lines_removed: None,
            };

            let json = serde_json::to_string(&meta).unwrap();
            assert!(!json.contains("linesAdded"));
            assert!(!json.contains("linesRemoved"));
        }

        #[test]
        fn serialization_includes_some_fields() {
            let meta = ToolMeta {
                tool_name: "Edit".to_string(),
                lines_added: Some(10),
                lines_removed: Some(3),
            };

            let json = serde_json::to_string(&meta).unwrap();
            assert!(
                json.contains("\"linesAdded\":10")
                    || json.contains("\"lines_added\":10")
                    || json.contains("linesAdded")
            );
        }
    }

    mod question_item {
        use super::*;

        #[test]
        fn multi_select_defaults_to_false() {
            let json = r#"{
                "question": "Which option?",
                "header": "Choice",
                "options": []
            }"#;

            let item: QuestionItem = serde_json::from_str(json).unwrap();
            assert!(!item.multi_select);
        }

        #[test]
        fn multi_select_can_be_true() {
            let json = r#"{
                "question": "Select all that apply",
                "header": "Features",
                "options": [],
                "multi_select": true
            }"#;

            let item: QuestionItem = serde_json::from_str(json).unwrap();
            assert!(item.multi_select);
        }
    }
}
