//! Tauri commands for the Overdrive task ledger.
//!
//! Thin wrappers over `overseer_core::persistence` task functions, mirroring the
//! `persistence` command module. The HTTP daemon exposes the same operations via
//! its own dispatchers; both call the same core functions.

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
