//! Approvals Tauri commands.
//!
//! Thin wrapper around overseer-core's ProjectApprovalManager.
//! The business logic lives in overseer-core; this module just exposes Tauri commands.

use std::sync::Arc;

use overseer_core::persistence::types::ApprovalsData;

// Re-export for backwards compatibility
pub use overseer_core::managers::ProjectApprovalManager;

// ============================================================================
// Tauri Commands
// ============================================================================

/// Load approvals for a project (for settings display).
#[tauri::command]
pub fn load_project_approvals(
    state: tauri::State<'_, Arc<ProjectApprovalManager>>,
    project_name: String,
) -> ApprovalsData {
    state.load_approvals(&project_name)
}

/// Add a tool or prefix approval.
#[tauri::command]
pub fn add_approval(
    state: tauri::State<'_, Arc<ProjectApprovalManager>>,
    project_name: String,
    tool_or_prefix: String,
    is_prefix: bool,
) -> Result<(), String> {
    log::info!(
        "add_approval called: project='{}', tool_or_prefix='{}', is_prefix={}",
        project_name,
        tool_or_prefix,
        is_prefix
    );
    let result = state.add_approval(&project_name, &tool_or_prefix, is_prefix);
    log::info!("add_approval result: {:?}", result);
    result
}

/// Remove a tool or prefix approval.
#[tauri::command]
pub fn remove_approval(
    state: tauri::State<'_, Arc<ProjectApprovalManager>>,
    project_name: String,
    tool_or_prefix: String,
    is_prefix: bool,
) -> Result<(), String> {
    state.remove_approval(&project_name, &tool_or_prefix, is_prefix)
}

/// Clear all approvals for a project.
#[tauri::command]
pub fn clear_project_approvals(
    state: tauri::State<'_, Arc<ProjectApprovalManager>>,
    project_name: String,
) -> Result<(), String> {
    state.clear_approvals(&project_name)
}
