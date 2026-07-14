//! The headless turn driver.
//!
//! [`run_turn`] wires the existing managers together to drive one agent turn
//! with no frontend attached, and [`await_turn_completion`] is the isolated,
//! unit-testable core that decides *when a turn is done* purely from
//! event-bus traffic.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::broadcast::{self, error::RecvError};

use crate::agents::event::AgentEvent;
use crate::context::OverseerContext;
use crate::event_bus::BroadcastEvent;
use crate::managers::ClaudeStartConfig;
use crate::persistence::types::ChatMetadata;

use super::{TurnOutcome, TurnParams};

/// YOLO permission mode for unattended Claude runs. Mirrors the frontend's
/// `getYoloModeValueForAgent("claude")`; the safety boundary for Overdrive is
/// the disposable workspace + human review gate, not permission prompts.
const CLAUDE_YOLO_PERMISSION_MODE: &str = "bypassPermissions";

/// Drive a single agent turn to completion with no frontend attached.
///
/// Registers a chat session (so events persist and get seq numbers), subscribes
/// to the event bus *before* sending, spawns the agent via the existing
/// [`crate::managers::ClaudeAgentManager`], and blocks until the turn completes,
/// fails, or the wall-clock cap elapses.
pub async fn run_turn(ctx: &OverseerContext, params: TurnParams) -> TurnOutcome {
    // 1. Register the chat session so agent events are persisted + sequenced.
    let now = Utc::now();
    let metadata = ChatMetadata {
        id: params.conversation_id.clone(),
        workspace_id: params.workspace_name.clone(),
        label: params
            .chat_label
            .clone()
            .unwrap_or_else(|| "Overdrive run".to_string()),
        agent_type: Some("claude".to_string()),
        agent_session_id: params.session_id.clone(),
        model_version: params.model.clone(),
        permission_mode: Some(CLAUDE_YOLO_PERMISSION_MODE.to_string()),
        created_at: now,
        updated_at: now,
    };

    if let Err(e) = ctx.chat_sessions.register_session(
        params.conversation_id.clone(),
        params.project_name.clone(),
        params.workspace_name.clone(),
        metadata,
    ) {
        return TurnOutcome::Failed {
            reason: format!("failed to register chat session: {e}"),
        };
    }

    // 2. Subscribe BEFORE sending so we can't miss early events (the race the
    //    frontend also avoids by subscribing on mount).
    let rx = ctx.event_bus.subscribe();

    // 3. Build the Claude config, forcing YOLO for unattended operation.
    let config = ClaudeStartConfig {
        conversation_id: params.conversation_id.clone(),
        project_name: params.project_name.clone(),
        prompt: params.prompt.clone(),
        working_dir: params.working_dir.clone(),
        agent_path: params.agent_path.clone(),
        session_id: params.session_id.clone(),
        model_version: params.model.clone(),
        log_dir: params.log_dir.clone(),
        log_id: params.log_id.clone(),
        permission_mode: Some(CLAUDE_YOLO_PERMISSION_MODE.to_string()),
        agent_shell: None,
        effort_level: None,
    };

    // 4. Spawn the agent (this also persists + emits the user message).
    if let Err(e) = ctx.claude_agents.send_message(
        config,
        Arc::clone(&ctx.event_bus),
        Arc::clone(&ctx.approval_manager),
        Arc::clone(&ctx.chat_sessions),
    ) {
        return TurnOutcome::Failed {
            reason: format!("failed to start agent: {e}"),
        };
    }

    // 5. Await turn completion purely by observing the event bus.
    await_turn_completion(rx, &params.conversation_id, params.timeout).await
}

/// Await a single turn's completion on the event bus, bounded by `timeout`.
///
/// Isolated from the spawn side so it can be unit-tested by emitting
/// hand-built [`BroadcastEvent`]s — no real agent CLI required.
async fn await_turn_completion(
    rx: broadcast::Receiver<BroadcastEvent>,
    conversation_id: &str,
    timeout: Duration,
) -> TurnOutcome {
    match tokio::time::timeout(timeout, collect_turn(rx, conversation_id)).await {
        Ok(outcome) => outcome,
        Err(_) => TurnOutcome::TimedOut,
    }
}

/// Drain event-bus traffic for one conversation until the turn terminates.
async fn collect_turn(
    mut rx: broadcast::Receiver<BroadcastEvent>,
    conversation_id: &str,
) -> TurnOutcome {
    let event_topic = format!("agent:event:{conversation_id}");
    let close_topic = format!("agent:close:{conversation_id}");
    let mut buffer = String::new();

    loop {
        match rx.recv().await {
            Ok(event) if event.event_type == event_topic => {
                // The payload is a flattened `SeqEvent` on the normal path, or a
                // bare `AgentEvent` on the persistence-failure fallback. Both
                // deserialize directly as `AgentEvent` (the extra `seq` field is
                // ignored by the internally-tagged enum).
                let agent_event: AgentEvent = match serde_json::from_value(event.payload) {
                    Ok(ev) => ev,
                    Err(_) => continue,
                };
                match agent_event {
                    AgentEvent::Text { text } => buffer.push_str(&text),
                    AgentEvent::Message { content, .. } => buffer.push_str(&content),
                    AgentEvent::TurnComplete | AgentEvent::Done => {
                        return TurnOutcome::Completed { text: buffer };
                    }
                    AgentEvent::Error { message } => {
                        return TurnOutcome::Failed { reason: message };
                    }
                    // The agent is blocked on a question. The turn will never
                    // complete on its own, so surface it and let the run pause.
                    AgentEvent::Question { questions, .. } => {
                        let question = questions
                            .first()
                            .map(|q| q.question.clone())
                            .unwrap_or_else(|| "agent asked a question".to_string());
                        return TurnOutcome::NeedsInput { question };
                    }
                    _ => {}
                }
            }
            Ok(event) if event.event_type == close_topic => {
                // Process ended without an explicit TurnComplete — treat the
                // accumulated text as the result rather than hanging.
                return TurnOutcome::Completed { text: buffer };
            }
            // Events for other conversations / unrelated topics: ignore.
            Ok(_) => {}
            // Slow-subscriber lag: we may have missed events, but the turn can
            // still complete — keep listening.
            Err(RecvError::Lagged(_)) => {}
            // The bus was torn down before the turn finished.
            Err(RecvError::Closed) => {
                return TurnOutcome::Failed {
                    reason: "event bus closed before turn completed".to_string(),
                };
            }
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================
//
// These exercise the risky part of Phase 1 — completion detection — without a
// real agent CLI, by emitting hand-built events onto a real EventBus. This is
// why `await_turn_completion` is split out from the spawn side.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::EventBus;
    use crate::persistence::SeqEvent;
    use crate::shell::AgentExit;

    /// Emit an agent event exactly as the real managers do: a flattened
    /// `SeqEvent` on the `agent:event:{conv}` topic.
    fn emit_event(bus: &EventBus, conv: &str, seq: u64, event: AgentEvent) {
        let seq_event = SeqEvent { seq, event };
        bus.emit(&format!("agent:event:{conv}"), &seq_event);
    }

    /// Emit a process-close event on the `agent:close:{conv}` topic.
    fn emit_close(bus: &EventBus, conv: &str, code: i32) {
        bus.emit(
            &format!("agent:close:{conv}"),
            &AgentExit { code, signal: None },
        );
    }

    const LONG_TIMEOUT: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn completes_on_turn_complete_with_accumulated_text() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        // Buffered by the broadcast channel; consumed once we await below.
        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "Hello ".into(),
            },
        );
        emit_event(
            &bus,
            "conv-1",
            2,
            AgentEvent::Text {
                text: "world".into(),
            },
        );
        emit_event(&bus, "conv-1", 3, AgentEvent::TurnComplete);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Completed {
                text: "Hello world".into()
            }
        );
    }

    #[tokio::test]
    async fn done_event_also_completes() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(&bus, "conv-1", 1, AgentEvent::Text { text: "hi".into() });
        emit_event(&bus, "conv-1", 2, AgentEvent::Done);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(outcome, TurnOutcome::Completed { text: "hi".into() });
    }

    #[tokio::test]
    async fn message_content_is_accumulated() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Message {
                content: "from message".into(),
                tool_meta: None,
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            },
        );
        emit_event(&bus, "conv-1", 2, AgentEvent::TurnComplete);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Completed {
                text: "from message".into()
            }
        );
    }

    #[tokio::test]
    async fn error_event_fails_the_turn() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "partial".into(),
            },
        );
        emit_event(
            &bus,
            "conv-1",
            2,
            AgentEvent::Error {
                message: "boom".into(),
            },
        );

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Failed {
                reason: "boom".into()
            }
        );
    }

    #[tokio::test]
    async fn close_without_turn_complete_completes_from_buffer() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "orphan".into(),
            },
        );
        emit_close(&bus, "conv-1", 0);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Completed {
                text: "orphan".into()
            }
        );
    }

    #[tokio::test]
    async fn events_for_other_conversations_are_ignored() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        // Noise from a different conversation must not affect conv-1.
        emit_event(
            &bus,
            "conv-2",
            1,
            AgentEvent::Error {
                message: "not ours".into(),
            },
        );
        emit_event(&bus, "conv-2", 2, AgentEvent::TurnComplete);
        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "ours".into(),
            },
        );
        emit_event(&bus, "conv-1", 2, AgentEvent::TurnComplete);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Completed {
                text: "ours".into()
            }
        );
    }

    #[tokio::test]
    async fn times_out_when_no_terminal_event_arrives() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "no end".into(),
            },
        );
        // No TurnComplete / Done / close — should hit the wall-clock cap.

        let outcome = await_turn_completion(rx, "conv-1", Duration::from_millis(50)).await;
        assert_eq!(outcome, TurnOutcome::TimedOut);
    }

    #[tokio::test]
    async fn lag_does_not_abort_before_completion() {
        // Capacity 2, but we push 4 events before consuming any → the receiver
        // observes RecvError::Lagged, then catches up to the retained tail which
        // still contains TurnComplete. The turn must still complete.
        let bus = EventBus::with_capacity(2);
        let rx = bus.subscribe();

        emit_event(&bus, "conv-1", 1, AgentEvent::Text { text: "a".into() });
        emit_event(&bus, "conv-1", 2, AgentEvent::Text { text: "b".into() });
        emit_event(&bus, "conv-1", 3, AgentEvent::Text { text: "c".into() });
        emit_event(&bus, "conv-1", 4, AgentEvent::TurnComplete);

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert!(
            matches!(outcome, TurnOutcome::Completed { .. }),
            "expected Completed despite lag, got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn question_event_yields_needs_input() {
        let bus = EventBus::new();
        let rx = bus.subscribe();

        emit_event(
            &bus,
            "conv-1",
            1,
            AgentEvent::Text {
                text: "hmm ".into(),
            },
        );
        emit_event(
            &bus,
            "conv-1",
            2,
            AgentEvent::Question {
                request_id: "q1".into(),
                questions: vec![crate::agents::event::QuestionItem {
                    question: "Which database?".into(),
                    header: "DB".into(),
                    options: vec![],
                    multi_select: false,
                }],
                raw_input: None,
                is_processed: None,
            },
        );

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::NeedsInput {
                question: "Which database?".into()
            }
        );
    }

    #[tokio::test]
    async fn closed_bus_fails_the_turn() {
        let bus = EventBus::new();
        let rx = bus.subscribe();
        drop(bus); // Sender gone → next recv() yields RecvError::Closed.

        let outcome = await_turn_completion(rx, "conv-1", LONG_TIMEOUT).await;
        assert_eq!(
            outcome,
            TurnOutcome::Failed {
                reason: "event bus closed before turn completed".into()
            }
        );
    }
}
