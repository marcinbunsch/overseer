//! Agent process management modules.
//!
//! Each agent backend (Claude, Codex, Copilot, Gemini) has its own module that handles
//! spawning, stdin/stdout communication, and lifecycle management.
//!
//! Agent-specific configuration and process spawning logic lives in `overseer_core::spawn`.
//! These modules are thin wrappers that forward events to Tauri.

pub mod claude;
pub mod codex;
pub mod copilot;
pub mod gemini;
pub mod opencode;

// Re-export state types for .manage() calls
pub use claude::AgentProcessMap;
pub use codex::CodexServerMap;
pub use copilot::CopilotServerMap;
pub use gemini::GeminiServerMap;
pub use opencode::OpenCodeServerMap;

use crate::approvals::ProjectApprovalManager;
use crate::logging::{log_line, LogHandle};
use overseer_core::agents::event::AgentEvent;
use overseer_core::spawn::AgentProcess;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Result of checking if a ToolApproval should be auto-approved.
pub enum ApprovalCheckResult {
    /// The tool was auto-approved. Contains the modified event with `auto_approved: true`.
    AutoApproved(AgentEvent),
    /// The tool was not auto-approved. Contains the original event unchanged.
    NotApproved(AgentEvent),
}

/// Check if a ToolApproval event should be auto-approved based on project settings.
///
/// This is shared logic used by all agent backends (Claude, Codex, Copilot).
///
/// # Arguments
/// * `app` - Tauri app handle for accessing approval manager state
/// * `project_name` - The project name for approval lookup
/// * `event` - The AgentEvent to check (only ToolApproval is processed)
/// * `process_arc` - The agent process to write approval response to
/// * `log_file` - Log handle for logging the response
/// * `build_response` - Function to build the approval response string for this agent type
///
/// # Returns
/// * `ApprovalCheckResult::AutoApproved(event)` - Event was auto-approved, response was sent
/// * `ApprovalCheckResult::NotApproved(event)` - Event was not auto-approved, pass to frontend
pub fn check_auto_approval<F>(
    app: &tauri::AppHandle,
    project_name: &str,
    event: AgentEvent,
    process_arc: &Arc<Mutex<Option<AgentProcess>>>,
    log_file: &LogHandle,
    build_response: F,
) -> ApprovalCheckResult
where
    F: FnOnce(&str, &serde_json::Value) -> String,
{
    match &event {
        AgentEvent::ToolApproval {
            request_id,
            name,
            input,
            display_input,
            prefixes,
            ..
        } => {
            let prefixes_vec: Vec<String> = prefixes.as_ref().cloned().unwrap_or_default();

            // Query the approval manager fresh each time to pick up new approvals
            let approval_manager: tauri::State<Arc<ProjectApprovalManager>> = app.state();
            let should_approve =
                approval_manager.should_auto_approve(project_name, name, &prefixes_vec);

            log::info!(
                "Checking approval for {} with prefixes {:?} -> {}",
                name,
                prefixes_vec,
                should_approve
            );

            if should_approve {
                // Auto-approve: send response directly to agent
                let response = build_response(request_id, input);
                log_line(log_file, "STDIN", &response);
                log::info!(
                    "Auto-approving {} for project {} (prefixes: {:?})",
                    name,
                    project_name,
                    prefixes_vec
                );

                // Write approval to agent stdin
                if let Ok(guard) = process_arc.lock() {
                    if let Some(ref process) = *guard {
                        let _ = process.write_stdin(&response);
                    }
                }

                // Return event with auto_approved = true
                ApprovalCheckResult::AutoApproved(AgentEvent::ToolApproval {
                    request_id: request_id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                    display_input: display_input.clone(),
                    prefixes: prefixes.clone(),
                    auto_approved: true,
                    is_processed: None,
                })
            } else {
                // Not auto-approved, pass through unchanged
                ApprovalCheckResult::NotApproved(event)
            }
        }
        // Non-ToolApproval events pass through unchanged
        _ => ApprovalCheckResult::NotApproved(event),
    }
}
