//! Overdrive — headless autonomous run engine.
//!
//! Overdrive picks up queued tasks and runs each as an autonomous session in a
//! fresh workspace, verified by a machine-run harness, with **no frontend
//! attached** (primary target: `overseer-daemon` on a server). See
//! `docs/plans/overdrive.md` for the full design.
//!
//! # Phase 1 (this module today)
//!
//! Phase 1 proves the one unproven assumption in the design: *can core drive a
//! chat session end-to-end with no frontend connected?* [`run_turn`] does
//! exactly that — it registers a chat session, spawns the agent, and awaits
//! turn completion purely by observing the core [`crate::event_bus::EventBus`].
//! There is deliberately no ledger, scheduler, or run state machine yet; those
//! are later phases built on top of this loop.

use std::time::Duration;

use serde::{Deserialize, Serialize};

mod iterator;

pub use iterator::run_turn;

/// Parameters for a single headless turn.
#[derive(Debug, Clone)]
pub struct TurnParams {
    /// Conversation/chat id — also the key for the agent process and the
    /// `agent:event:{id}` / `agent:close:{id}` event-bus topics.
    pub conversation_id: String,
    /// Project name (chat persistence dir + approval context).
    pub project_name: String,
    /// Workspace name (chat persistence dir).
    pub workspace_name: String,
    /// Working directory the agent runs in — an existing checkout/worktree.
    /// (Provisioning a fresh worktree is a later phase.)
    pub working_dir: String,
    /// Path to the `claude` binary (or just `"claude"` to resolve via PATH).
    pub agent_path: String,
    /// The prompt to send.
    pub prompt: String,
    /// Optional model override.
    pub model: Option<String>,
    /// Optional session id to resume.
    pub session_id: Option<String>,
    /// Wall-clock cap for the turn.
    pub timeout: Duration,
}

/// Outcome of a single headless turn.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TurnOutcome {
    /// Turn completed; `text` is the accumulated assistant response.
    Completed { text: String },
    /// Turn failed (agent error, process died early, or spawn/registration error).
    Failed { reason: String },
    /// Turn exceeded the wall-clock cap without completing.
    TimedOut,
}
