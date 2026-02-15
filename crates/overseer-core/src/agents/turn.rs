//! Turn as a first-class citizen.
//!
//! A turn represents a user message and the agent's complete response,
//! including all events that occurred during processing.

use super::event::AgentEvent;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier for a turn.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TurnId(pub String);

impl TurnId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl Default for TurnId {
    fn default() -> Self {
        Self::new()
    }
}

/// Unique identifier for an event within a turn.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EventId(pub String);

impl EventId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl Default for EventId {
    fn default() -> Self {
        Self::new()
    }
}

/// Status of a turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TurnStatus {
    /// Turn is actively being processed.
    InProgress,

    /// Waiting for user to approve a tool.
    WaitingForApproval { request_id: String },

    /// Waiting for user to answer a question.
    WaitingForQuestion { request_id: String },

    /// Waiting for user to approve a plan.
    WaitingForPlan { request_id: String },

    /// Turn completed successfully.
    Completed,

    /// Turn was cancelled.
    Cancelled,
}

/// A user's decision on an approval request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Decision {
    /// Approved this one time.
    Approved,

    /// Approved and remember for future (add to approval context).
    ApprovedAll,

    /// Denied, optionally with a reason for the agent.
    Denied {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },

    /// Answered a question.
    Answered { answers: Vec<Answer> },

    /// Approved the plan.
    PlanApproved,

    /// Rejected the plan with optional feedback.
    PlanRejected {
        #[serde(skip_serializing_if = "Option::is_none")]
        feedback: Option<String>,
    },
}

/// An answer to a question.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answer {
    pub question_index: usize,
    pub selected_options: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_text: Option<String>,
}

/// Resolution of an event that required user input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventResolution {
    pub decision: Decision,
    pub decided_at: DateTime<Utc>,
}

/// An event within a turn, with optional resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnEvent {
    /// Unique event ID for tracking.
    pub id: EventId,

    /// The actual event.
    pub kind: AgentEvent,

    /// When this event occurred.
    pub timestamp: DateTime<Utc>,

    /// Resolution (if event required user input).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<EventResolution>,
}

impl TurnEvent {
    pub fn new(kind: AgentEvent) -> Self {
        Self {
            id: EventId::new(),
            kind,
            timestamp: Utc::now(),
            resolution: None,
        }
    }

    pub fn with_resolution(mut self, resolution: EventResolution) -> Self {
        self.resolution = Some(resolution);
        self
    }
}

/// A complete turn: user message + agent response with all events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    /// Unique turn ID.
    pub id: TurnId,

    /// The user's message that started this turn.
    pub user_message: String,

    /// All events that occurred during this turn.
    pub events: Vec<TurnEvent>,

    /// When the turn started.
    pub started_at: DateTime<Utc>,

    /// When the turn completed (if completed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,

    /// Current status of the turn.
    pub status: TurnStatus,
}

impl Turn {
    pub fn new(user_message: String) -> Self {
        Self {
            id: TurnId::new(),
            user_message,
            events: Vec::new(),
            started_at: Utc::now(),
            completed_at: None,
            status: TurnStatus::InProgress,
        }
    }

    /// Add an event to this turn.
    pub fn add_event(&mut self, event: TurnEvent) {
        self.events.push(event);
    }

    /// Find an event by ID (mutable).
    pub fn find_event_mut(&mut self, event_id: &EventId) -> Option<&mut TurnEvent> {
        self.events.iter_mut().find(|e| &e.id == event_id)
    }

    /// Mark the turn as completed.
    pub fn complete(&mut self) {
        self.status = TurnStatus::Completed;
        self.completed_at = Some(Utc::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod turn_id {
        use super::*;

        #[test]
        fn new_generates_unique_ids() {
            let id1 = TurnId::new();
            let id2 = TurnId::new();
            assert_ne!(id1, id2);
        }

        #[test]
        fn default_generates_unique_id() {
            let id1 = TurnId::default();
            let id2 = TurnId::default();
            assert_ne!(id1, id2);
        }

        #[test]
        fn equality() {
            let id1 = TurnId("same-id".to_string());
            let id2 = TurnId("same-id".to_string());
            let id3 = TurnId("different-id".to_string());

            assert_eq!(id1, id2);
            assert_ne!(id1, id3);
        }

        #[test]
        fn can_be_used_as_hashmap_key() {
            use std::collections::HashMap;
            let mut map = HashMap::new();
            let id = TurnId("test-id".to_string());
            map.insert(id.clone(), "value");
            assert_eq!(map.get(&id), Some(&"value"));
        }

        #[test]
        fn serialization_roundtrip() {
            let id = TurnId("turn-456".to_string());
            let json = serde_json::to_string(&id).unwrap();
            let deserialized: TurnId = serde_json::from_str(&json).unwrap();
            assert_eq!(id, deserialized);
        }
    }

    mod event_id {
        use super::*;

        #[test]
        fn new_generates_unique_ids() {
            let id1 = EventId::new();
            let id2 = EventId::new();
            assert_ne!(id1, id2);
        }

        #[test]
        fn default_generates_unique_id() {
            let id1 = EventId::default();
            let id2 = EventId::default();
            assert_ne!(id1, id2);
        }

        #[test]
        fn equality() {
            let id1 = EventId("event-1".to_string());
            let id2 = EventId("event-1".to_string());
            let id3 = EventId("event-2".to_string());

            assert_eq!(id1, id2);
            assert_ne!(id1, id3);
        }

        #[test]
        fn serialization_roundtrip() {
            let id = EventId("event-789".to_string());
            let json = serde_json::to_string(&id).unwrap();
            let deserialized: EventId = serde_json::from_str(&json).unwrap();
            assert_eq!(id, deserialized);
        }
    }

    mod turn_status {
        use super::*;

        #[test]
        fn in_progress_serialization() {
            let status = TurnStatus::InProgress;
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, TurnStatus::InProgress));
        }

        #[test]
        fn waiting_for_approval_serialization() {
            let status = TurnStatus::WaitingForApproval {
                request_id: "req-123".to_string(),
            };
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();

            match parsed {
                TurnStatus::WaitingForApproval { request_id } => {
                    assert_eq!(request_id, "req-123")
                }
                _ => panic!("Expected WaitingForApproval"),
            }
        }

        #[test]
        fn waiting_for_question_serialization() {
            let status = TurnStatus::WaitingForQuestion {
                request_id: "req-456".to_string(),
            };
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();

            match parsed {
                TurnStatus::WaitingForQuestion { request_id } => {
                    assert_eq!(request_id, "req-456")
                }
                _ => panic!("Expected WaitingForQuestion"),
            }
        }

        #[test]
        fn waiting_for_plan_serialization() {
            let status = TurnStatus::WaitingForPlan {
                request_id: "req-789".to_string(),
            };
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();

            match parsed {
                TurnStatus::WaitingForPlan { request_id } => {
                    assert_eq!(request_id, "req-789")
                }
                _ => panic!("Expected WaitingForPlan"),
            }
        }

        #[test]
        fn completed_serialization() {
            let status = TurnStatus::Completed;
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, TurnStatus::Completed));
        }

        #[test]
        fn cancelled_serialization() {
            let status = TurnStatus::Cancelled;
            let json = serde_json::to_string(&status).unwrap();
            let parsed: TurnStatus = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, TurnStatus::Cancelled));
        }
    }

    mod decision {
        use super::*;

        #[test]
        fn approved_serialization() {
            let decision = Decision::Approved;
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, Decision::Approved));
        }

        #[test]
        fn approved_all_serialization() {
            let decision = Decision::ApprovedAll;
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, Decision::ApprovedAll));
        }

        #[test]
        fn denied_without_reason() {
            let decision = Decision::Denied { reason: None };
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();

            match parsed {
                Decision::Denied { reason } => assert!(reason.is_none()),
                _ => panic!("Expected Denied"),
            }
        }

        #[test]
        fn denied_with_reason() {
            let decision = Decision::Denied {
                reason: Some("This command is too dangerous".to_string()),
            };
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();

            match parsed {
                Decision::Denied { reason } => {
                    assert_eq!(reason, Some("This command is too dangerous".to_string()))
                }
                _ => panic!("Expected Denied"),
            }
        }

        #[test]
        fn answered_serialization() {
            let decision = Decision::Answered {
                answers: vec![
                    Answer {
                        question_index: 0,
                        selected_options: vec![1],
                        custom_text: None,
                    },
                    Answer {
                        question_index: 1,
                        selected_options: vec![0, 2],
                        custom_text: Some("Custom input".to_string()),
                    },
                ],
            };

            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();

            match parsed {
                Decision::Answered { answers } => {
                    assert_eq!(answers.len(), 2);
                    assert_eq!(answers[0].question_index, 0);
                    assert_eq!(answers[0].selected_options, vec![1]);
                    assert!(answers[0].custom_text.is_none());
                    assert_eq!(answers[1].question_index, 1);
                    assert_eq!(answers[1].selected_options, vec![0, 2]);
                    assert_eq!(answers[1].custom_text, Some("Custom input".to_string()));
                }
                _ => panic!("Expected Answered"),
            }
        }

        #[test]
        fn plan_approved_serialization() {
            let decision = Decision::PlanApproved;
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();
            assert!(matches!(parsed, Decision::PlanApproved));
        }

        #[test]
        fn plan_rejected_without_feedback() {
            let decision = Decision::PlanRejected { feedback: None };
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();

            match parsed {
                Decision::PlanRejected { feedback } => assert!(feedback.is_none()),
                _ => panic!("Expected PlanRejected"),
            }
        }

        #[test]
        fn plan_rejected_with_feedback() {
            let decision = Decision::PlanRejected {
                feedback: Some("Please consider performance implications".to_string()),
            };
            let json = serde_json::to_string(&decision).unwrap();
            let parsed: Decision = serde_json::from_str(&json).unwrap();

            match parsed {
                Decision::PlanRejected { feedback } => {
                    assert_eq!(
                        feedback,
                        Some("Please consider performance implications".to_string())
                    )
                }
                _ => panic!("Expected PlanRejected"),
            }
        }
    }

    mod answer {
        use super::*;

        #[test]
        fn single_selection() {
            let answer = Answer {
                question_index: 0,
                selected_options: vec![2],
                custom_text: None,
            };

            let json = serde_json::to_string(&answer).unwrap();
            let parsed: Answer = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.question_index, 0);
            assert_eq!(parsed.selected_options, vec![2]);
            assert!(parsed.custom_text.is_none());
        }

        #[test]
        fn multi_selection() {
            let answer = Answer {
                question_index: 1,
                selected_options: vec![0, 1, 3],
                custom_text: None,
            };

            let json = serde_json::to_string(&answer).unwrap();
            let parsed: Answer = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.selected_options, vec![0, 1, 3]);
        }

        #[test]
        fn custom_text_only() {
            let answer = Answer {
                question_index: 0,
                selected_options: vec![],
                custom_text: Some("My custom answer".to_string()),
            };

            let json = serde_json::to_string(&answer).unwrap();
            let parsed: Answer = serde_json::from_str(&json).unwrap();

            assert!(parsed.selected_options.is_empty());
            assert_eq!(parsed.custom_text, Some("My custom answer".to_string()));
        }
    }

    mod event_resolution {
        use super::*;

        #[test]
        fn serialization_roundtrip() {
            let resolution = EventResolution {
                decision: Decision::Approved,
                decided_at: Utc::now(),
            };

            let json = serde_json::to_string(&resolution).unwrap();
            let parsed: EventResolution = serde_json::from_str(&json).unwrap();

            assert!(matches!(parsed.decision, Decision::Approved));
        }
    }

    mod turn_event {
        use super::*;

        #[test]
        fn new_creates_with_defaults() {
            let event = TurnEvent::new(AgentEvent::Text {
                text: "Hello".to_string(),
            });

            assert!(event.resolution.is_none());
            // ID should be unique
            let event2 = TurnEvent::new(AgentEvent::Done);
            assert_ne!(event.id, event2.id);
        }

        #[test]
        fn with_resolution_sets_resolution() {
            let event = TurnEvent::new(AgentEvent::TurnComplete).with_resolution(EventResolution {
                decision: Decision::Approved,
                decided_at: Utc::now(),
            });

            assert!(event.resolution.is_some());
            assert!(matches!(
                event.resolution.unwrap().decision,
                Decision::Approved
            ));
        }

        #[test]
        fn serialization_roundtrip() {
            let event = TurnEvent::new(AgentEvent::Error {
                message: "Test error".to_string(),
            });

            let json = serde_json::to_string(&event).unwrap();
            let parsed: TurnEvent = serde_json::from_str(&json).unwrap();

            match parsed.kind {
                AgentEvent::Error { message } => assert_eq!(message, "Test error"),
                _ => panic!("Expected Error event"),
            }
        }
    }

    mod turn {
        use super::*;

        #[test]
        fn new_initializes_correctly() {
            let turn = Turn::new("Hello, can you help me?".to_string());

            assert_eq!(turn.user_message, "Hello, can you help me?");
            assert!(turn.events.is_empty());
            assert!(turn.completed_at.is_none());
            assert!(matches!(turn.status, TurnStatus::InProgress));
        }

        #[test]
        fn new_generates_unique_ids() {
            let turn1 = Turn::new("msg1".to_string());
            let turn2 = Turn::new("msg2".to_string());
            assert_ne!(turn1.id, turn2.id);
        }

        #[test]
        fn add_event_appends() {
            let mut turn = Turn::new("test".to_string());

            turn.add_event(TurnEvent::new(AgentEvent::Text {
                text: "First".to_string(),
            }));
            turn.add_event(TurnEvent::new(AgentEvent::Text {
                text: "Second".to_string(),
            }));

            assert_eq!(turn.events.len(), 2);
        }

        #[test]
        fn find_event_mut_returns_existing() {
            let mut turn = Turn::new("test".to_string());
            let event = TurnEvent::new(AgentEvent::Done);
            let event_id = event.id.clone();
            turn.add_event(event);

            let found = turn.find_event_mut(&event_id);
            assert!(found.is_some());
            assert_eq!(found.unwrap().id, event_id);
        }

        #[test]
        fn find_event_mut_returns_none_for_nonexistent() {
            let mut turn = Turn::new("test".to_string());
            let fake_id = EventId("nonexistent".to_string());

            assert!(turn.find_event_mut(&fake_id).is_none());
        }

        #[test]
        fn find_event_mut_allows_modification() {
            let mut turn = Turn::new("test".to_string());
            let event = TurnEvent::new(AgentEvent::Done);
            let event_id = event.id.clone();
            turn.add_event(event);

            // Modify the event
            if let Some(event) = turn.find_event_mut(&event_id) {
                event.resolution = Some(EventResolution {
                    decision: Decision::Approved,
                    decided_at: Utc::now(),
                });
            }

            // Verify modification persisted
            let found = turn.find_event_mut(&event_id).unwrap();
            assert!(found.resolution.is_some());
        }

        #[test]
        fn complete_sets_status_and_timestamp() {
            let mut turn = Turn::new("test".to_string());
            assert!(turn.completed_at.is_none());
            assert!(matches!(turn.status, TurnStatus::InProgress));

            turn.complete();

            assert!(turn.completed_at.is_some());
            assert!(matches!(turn.status, TurnStatus::Completed));
        }

        #[test]
        fn serialization_roundtrip() {
            let mut turn = Turn::new("Help me debug".to_string());
            turn.add_event(TurnEvent::new(AgentEvent::Text {
                text: "Sure, let me help".to_string(),
            }));
            turn.complete();

            let json = serde_json::to_string(&turn).unwrap();
            let parsed: Turn = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed.user_message, "Help me debug");
            assert_eq!(parsed.events.len(), 1);
            assert!(matches!(parsed.status, TurnStatus::Completed));
            assert!(parsed.completed_at.is_some());
        }
    }
}
