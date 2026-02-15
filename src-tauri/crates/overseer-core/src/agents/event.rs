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
    },

    /// Agent wants user to approve a plan.
    PlanApproval {
        request_id: String,
        content: String,
    },

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
