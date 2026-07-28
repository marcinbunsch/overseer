//! Folding the persisted event stream into clean, driver-facing messages.
//!
//! An external agent driving Overseer wants readable messages, not the raw event
//! stream. Two views:
//!
//! - `text`: only the exchange — the driver's own messages and the coding agent's
//!   text replies.
//! - `full`: everything the desktop UI shows — adds thinking, tool calls, tool
//!   results and bash output.
//!
//! The persisted stream encodes assistant text, thinking and tool calls all as
//! [`AgentEvent::Message`], distinguished by the same convention the desktop UI
//! uses (`parseToolCall.ts`): a message is thinking when its tool metadata names
//! the "Thinking" tool, a tool call when its content starts with a `[ToolName]`
//! bracket, and plain assistant text otherwise. [`AgentEvent::Text`] events are
//! streaming deltas — the consolidated `Message` already carries the full text, so
//! the deltas are ignored in both views.

use serde::Serialize;

use overseer_core::agents::event::{AgentEvent, ToolMeta};
use overseer_core::persistence::SeqEvent;

/// Tool-metadata name Claude uses to mark a thinking block.
const THINKING_TOOL: &str = "Thinking";

/// Which messages a read request wants back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    /// Driver messages + coding-agent text replies only.
    Text,
    /// Everything the desktop UI shows (adds thinking, tool calls, results).
    Full,
}

impl View {
    /// Parse the `view` query parameter. Defaults to `Text` when absent.
    pub fn from_query(value: Option<&str>) -> Result<View, String> {
        match value.unwrap_or("text") {
            "text" => Ok(View::Text),
            "full" => Ok(View::Full),
            other => Err(format!(
                "Unknown view '{other}' (expected 'text' or 'full')"
            )),
        }
    }
}

/// A single driver-facing message.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiMessage {
    /// Sequence number of the source event (1-indexed line in the JSONL file).
    /// The driver passes the highest seq it has seen back as `sinceSeq`.
    pub seq: u64,
    /// "user", "assistant" or "tool".
    pub role: String,
    /// Sub-kind for non-text messages: "thinking", "tool", "toolResult",
    /// "bashOutput". Absent for plain text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Tool name for tool calls (e.g. "Bash", "Edit").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// The message text.
    pub text: String,
    /// True when a tool result reports an error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// The result of folding an event batch.
pub struct Fold {
    /// The messages selected by the view, in order.
    pub messages: Vec<ApiMessage>,
    /// True if the batch contained a turn-complete (or process-exit) marker,
    /// i.e. the coding agent finished its turn.
    pub turn_complete: bool,
    /// Highest sequence number seen in the batch (0 if empty).
    pub last_seq: u64,
}

/// Fold a batch of sequenced events into driver-facing messages for `view`.
pub fn fold_events(events: &[SeqEvent], view: View) -> Fold {
    let mut messages = Vec::new();
    let mut turn_complete = false;
    let mut last_seq = 0u64;

    for seq_event in events {
        last_seq = last_seq.max(seq_event.seq);
        let seq = seq_event.seq;

        match &seq_event.event {
            AgentEvent::UserMessage { content, meta, .. } => {
                // Skip the hidden "system" echo send_message persists alongside the
                // real user message (the same message the desktop UI hides).
                if is_system_meta(meta) {
                    continue;
                }
                messages.push(text_message(seq, "user", content.clone()));
            }

            AgentEvent::Message {
                content,
                tool_meta,
                is_info,
                ..
            } => {
                // Info messages (rate-limit notices, etc.) are UI chrome, not part
                // of the exchange — excluded from both views.
                if is_info.unwrap_or(false) {
                    continue;
                }

                let is_thinking = tool_meta
                    .as_ref()
                    .map(|meta| meta.tool_name == THINKING_TOOL)
                    .unwrap_or(false);

                if is_thinking {
                    push_full(
                        &mut messages,
                        view,
                        ApiMessage {
                            seq,
                            role: "assistant".to_string(),
                            kind: Some("thinking".to_string()),
                            tool_name: None,
                            text: content.clone(),
                            is_error: None,
                        },
                    );
                    continue;
                }

                if let Some(tool_name) = tool_call_name(content, tool_meta) {
                    push_full(
                        &mut messages,
                        view,
                        ApiMessage {
                            seq,
                            role: "assistant".to_string(),
                            kind: Some("tool".to_string()),
                            tool_name: Some(tool_name),
                            text: content.clone(),
                            is_error: None,
                        },
                    );
                    continue;
                }

                // Plain assistant text reply — the heart of the exchange.
                messages.push(text_message(seq, "assistant", content.clone()));
            }

            AgentEvent::ToolResult {
                content, is_error, ..
            } => {
                push_full(
                    &mut messages,
                    view,
                    ApiMessage {
                        seq,
                        role: "tool".to_string(),
                        kind: Some("toolResult".to_string()),
                        tool_name: None,
                        text: content.clone(),
                        is_error: Some(*is_error),
                    },
                );
            }

            AgentEvent::BashOutput { text } => {
                push_full(
                    &mut messages,
                    view,
                    ApiMessage {
                        seq,
                        role: "tool".to_string(),
                        kind: Some("bashOutput".to_string()),
                        tool_name: None,
                        text: text.clone(),
                        is_error: None,
                    },
                );
            }

            AgentEvent::Thinking { text } => {
                // The Claude parser encodes thinking as Message+Thinking meta, but
                // other backends may use this variant directly.
                push_full(
                    &mut messages,
                    view,
                    ApiMessage {
                        seq,
                        role: "assistant".to_string(),
                        kind: Some("thinking".to_string()),
                        tool_name: None,
                        text: text.clone(),
                        is_error: None,
                    },
                );
            }

            AgentEvent::TurnComplete | AgentEvent::Done => {
                turn_complete = true;
            }

            // Streaming deltas (Text), approval prompts, session ids and overseer
            // actions are not part of either message view.
            _ => {}
        }
    }

    Fold {
        messages,
        turn_complete,
        last_seq,
    }
}

/// Push a message only for the `Full` view.
fn push_full(messages: &mut Vec<ApiMessage>, view: View, message: ApiMessage) {
    if view == View::Full {
        messages.push(message);
    }
}

fn text_message(seq: u64, role: &str, text: String) -> ApiMessage {
    ApiMessage {
        seq,
        role: role.to_string(),
        kind: None,
        tool_name: None,
        text,
        is_error: None,
    }
}

/// True if a user message carries the `{ "type": "system" }` marker.
fn is_system_meta(meta: &Option<serde_json::Value>) -> bool {
    meta.as_ref()
        .and_then(|m| m.get("type"))
        .and_then(|t| t.as_str())
        == Some("system")
}

/// Return the tool name if this message is a tool call, else None.
///
/// Mirrors the desktop UI's `parseToolCall`: a tool call's content starts with a
/// `[ToolName]` bracket. The persisted tool metadata name is preferred when present
/// (it is set for `Edit`); otherwise the bracket label is used (e.g. `[Bash]`).
fn tool_call_name(content: &str, tool_meta: &Option<ToolMeta>) -> Option<String> {
    if !content.starts_with('[') {
        return None;
    }
    let bracket_end = content.find(']')?;
    if let Some(meta) = tool_meta {
        return Some(meta.tool_name.clone());
    }
    let label = content[1..bracket_end].trim();
    if label.is_empty() {
        None
    } else {
        Some(label.to_string())
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn seq(n: u64, event: AgentEvent) -> SeqEvent {
        SeqEvent { seq: n, event }
    }

    fn user(content: &str, system: bool) -> AgentEvent {
        AgentEvent::UserMessage {
            id: "msg-id".to_string(),
            content: content.to_string(),
            timestamp: Utc::now(),
            meta: if system {
                Some(serde_json::json!({ "type": "system", "label": "System" }))
            } else {
                None
            },
        }
    }

    fn assistant_text(content: &str) -> AgentEvent {
        AgentEvent::Message {
            content: content.to_string(),
            tool_meta: None,
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: None,
        }
    }

    fn thinking(content: &str) -> AgentEvent {
        AgentEvent::Message {
            content: content.to_string(),
            tool_meta: Some(ToolMeta {
                tool_name: "Thinking".to_string(),
                lines_added: Some(0),
                lines_removed: Some(0),
            }),
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: None,
        }
    }

    /// A Bash tool call: content starts with `[Bash]` and, like all non-Edit
    /// tools, carries no tool metadata.
    fn bash_call(command: &str) -> AgentEvent {
        AgentEvent::Message {
            content: format!("[Bash]\n{{\n  \"command\": \"{command}\"\n}}"),
            tool_meta: None,
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: None,
        }
    }

    /// A realistic single turn: user asks, agent thinks, runs a command, replies.
    fn sample_turn() -> Vec<SeqEvent> {
        vec![
            seq(1, user("add a HELLO.md that says hi", false)),
            // send_message persists this hidden echo of the prompt
            seq(2, user("add a HELLO.md that says hi", true)),
            seq(3, thinking("The user wants a new file named HELLO.md.")),
            seq(4, bash_call("echo hi > HELLO.md")),
            seq(
                5,
                AgentEvent::ToolResult {
                    tool_use_id: "tool-1".to_string(),
                    content: "".to_string(),
                    is_error: false,
                },
            ),
            seq(6, assistant_text("Done — created HELLO.md with \"hi\".")),
            seq(7, AgentEvent::TurnComplete),
        ]
    }

    #[test]
    fn text_view_returns_only_the_exchange() {
        let fold = fold_events(&sample_turn(), View::Text);

        // Only the driver's message and the agent's text reply — no system echo,
        // no thinking, no tool call, no tool result.
        assert_eq!(fold.messages.len(), 2);
        assert_eq!(fold.messages[0].role, "user");
        assert_eq!(fold.messages[0].text, "add a HELLO.md that says hi");
        assert_eq!(fold.messages[0].seq, 1);
        assert_eq!(fold.messages[1].role, "assistant");
        assert_eq!(fold.messages[1].kind, None);
        assert_eq!(
            fold.messages[1].text,
            "Done — created HELLO.md with \"hi\"."
        );
        assert_eq!(fold.messages[1].seq, 6);
    }

    #[test]
    fn full_view_returns_thinking_tools_and_results() {
        let fold = fold_events(&sample_turn(), View::Full);

        // user, thinking, tool call, tool result, assistant text.
        assert_eq!(fold.messages.len(), 5);
        assert_eq!(fold.messages[0].role, "user");
        assert_eq!(fold.messages[1].kind.as_deref(), Some("thinking"));
        assert_eq!(fold.messages[2].kind.as_deref(), Some("tool"));
        assert_eq!(fold.messages[2].tool_name.as_deref(), Some("Bash"));
        assert_eq!(fold.messages[3].kind.as_deref(), Some("toolResult"));
        assert_eq!(fold.messages[3].is_error, Some(false));
        assert_eq!(fold.messages[4].kind, None);
        assert_eq!(fold.messages[4].role, "assistant");
    }

    #[test]
    fn turn_complete_and_last_seq_are_reported() {
        let fold = fold_events(&sample_turn(), View::Text);
        assert!(fold.turn_complete);
        assert_eq!(fold.last_seq, 7);
    }

    #[test]
    fn done_marker_reports_turn_complete() {
        // When the agent process exits without a "result" line, the manager
        // persists a Done marker instead of TurnComplete. The fold must treat it
        // as turn-complete so the HTTP poller can stop. Regression for the API
        // hang where turn_complete never flipped and the poll spun for 20+ min.
        let events = vec![
            seq(1, user("hello", false)),
            seq(2, assistant_text("hi there")),
            seq(3, AgentEvent::Done),
        ];
        let fold = fold_events(&events, View::Text);
        assert!(fold.turn_complete);
        assert_eq!(fold.last_seq, 3);
    }

    #[test]
    fn incomplete_turn_reports_not_complete() {
        // No TurnComplete/Done marker yet.
        let events = vec![
            seq(1, user("hello", false)),
            seq(2, assistant_text("hi there")),
        ];
        let fold = fold_events(&events, View::Text);
        assert!(!fold.turn_complete);
        assert_eq!(fold.last_seq, 2);
    }

    #[test]
    fn empty_batch_has_zero_last_seq() {
        let fold = fold_events(&[], View::Full);
        assert!(fold.messages.is_empty());
        assert!(!fold.turn_complete);
        assert_eq!(fold.last_seq, 0);
    }

    #[test]
    fn info_messages_excluded_from_both_views() {
        let info = AgentEvent::Message {
            content: "Approaching usage limit".to_string(),
            tool_meta: None,
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: Some(true),
        };
        let events = vec![seq(1, info)];
        assert!(fold_events(&events, View::Text).messages.is_empty());
        assert!(fold_events(&events, View::Full).messages.is_empty());
    }

    #[test]
    fn edit_tool_call_uses_metadata_name() {
        // Edit is the one tool that carries metadata; the label matches the name.
        let edit = AgentEvent::Message {
            content: "[Edit]\n{\n  \"file_path\": \"a.rs\"\n}".to_string(),
            tool_meta: Some(ToolMeta {
                tool_name: "Edit".to_string(),
                lines_added: Some(3),
                lines_removed: Some(1),
            }),
            parent_tool_use_id: None,
            tool_use_id: None,
            is_info: None,
        };
        let fold = fold_events(&[seq(1, edit)], View::Full);
        assert_eq!(fold.messages.len(), 1);
        assert_eq!(fold.messages[0].kind.as_deref(), Some("tool"));
        assert_eq!(fold.messages[0].tool_name.as_deref(), Some("Edit"));
    }

    #[test]
    fn view_from_query_parses_and_defaults() {
        assert_eq!(View::from_query(None).unwrap(), View::Text);
        assert_eq!(View::from_query(Some("text")).unwrap(), View::Text);
        assert_eq!(View::from_query(Some("full")).unwrap(), View::Full);
        assert!(View::from_query(Some("bogus")).is_err());
    }
}
