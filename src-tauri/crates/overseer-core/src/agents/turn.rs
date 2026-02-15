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
