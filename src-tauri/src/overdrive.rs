//! Tauri commands for the Overdrive task ledger.
//!
//! Thin wrappers over `overseer_core::persistence` task functions, mirroring the
//! `persistence` command module. The HTTP daemon exposes the same operations via
//! its own dispatchers; both call the same core functions.

use std::sync::Arc;

use overseer_core::git::merge::MergeResult;
use overseer_core::overdrive::run::{list_runs, OverdriveRun};
use overseer_core::overdrive::OverdriveManager;
use overseer_core::persistence::{self, OverdriveTask};
use tauri::State;

use crate::persistence::PersistenceConfig;

/// List a repo's tasks, sorted by queue order.
#[tauri::command]
pub fn overdrive_list_tasks(
    state: State<PersistenceConfig>,
    repo: String,
) -> Result<Vec<OverdriveTask>, String> {
    let dir = state.get_config_dir()?;
    persistence::list_tasks(&dir, &repo).map_err(|e| e.to_string())
}

/// Insert or replace a task by id.
#[tauri::command]
pub fn overdrive_upsert_task(
    state: State<PersistenceConfig>,
    repo: String,
    task: OverdriveTask,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    persistence::upsert_task(&dir, &repo, task).map_err(|e| e.to_string())
}

/// Delete a task by id (no-op if missing).
#[tauri::command]
pub fn overdrive_delete_task(
    state: State<PersistenceConfig>,
    repo: String,
    task_id: String,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    persistence::delete_task(&dir, &repo, &task_id).map_err(|e| e.to_string())
}

/// Reassign queue order from the given ordered id list.
#[tauri::command]
pub fn overdrive_reorder_tasks(
    state: State<PersistenceConfig>,
    repo: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    persistence::reorder_tasks(&dir, &repo, &ordered_ids).map_err(|e| e.to_string())
}

/// Start a run for the top Todo task of `repo` (single-flight). Returns the
/// started task id, or None if there was no work. Async so it runs on Tauri's
/// tokio runtime (the manager spawns the run).
#[tauri::command]
pub async fn overdrive_run_next(
    manager: State<'_, Arc<OverdriveManager>>,
    repo: String,
) -> Result<Option<String>, String> {
    manager.run_next(&repo)
}

/// List all runs (newest first) — the review inbox.
#[tauri::command]
pub fn overdrive_list_runs(state: State<PersistenceConfig>) -> Result<Vec<OverdriveRun>, String> {
    let dir = state.get_config_dir()?;
    list_runs(&dir).map_err(|e| e.to_string())
}

/// Approve a run: merge its branch. Returns the merge result (conflicts if any).
#[tauri::command]
pub async fn overdrive_approve_run(
    manager: State<'_, Arc<OverdriveManager>>,
    run_id: String,
) -> Result<MergeResult, String> {
    manager.approve_run(&run_id).await
}

/// Reject a run: archive its workspace.
#[tauri::command]
pub async fn overdrive_reject_run(
    manager: State<'_, Arc<OverdriveManager>>,
    run_id: String,
) -> Result<(), String> {
    manager.reject_run(&run_id).await
}

/// Ensure a run's workspace is registered + chat indexed (backfill for older
/// runs). Returns the workspace id.
#[tauri::command]
pub fn overdrive_ensure_workspace(
    manager: State<Arc<OverdriveManager>>,
    run_id: String,
) -> Result<Option<String>, String> {
    manager.ensure_workspace(&run_id)
}
