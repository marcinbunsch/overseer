//! Tauri commands for persistence operations.
//!
//! This module wraps the `overseer_core::persistence` functions as Tauri commands,
//! allowing the frontend to perform file I/O through the backend.
//!
//! # Design Principle
//!
//! The frontend should NEVER write files directly. All persistence goes through
//! these Tauri commands to ensure:
//! - Atomic writes (write-then-rename)
//! - Consistent file locations
//! - Proper error handling
//! - Future migration to event-sourced architecture

use overseer_core::persistence::{
    self, ChatFile, ChatIndex, ChatIndexEntry, Project, ProjectRegistry, WorkspaceState,
};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Managed state holding the config directory path.
/// Set during app setup based on debug/release mode.
pub struct PersistenceConfig {
    config_dir: Mutex<Option<PathBuf>>,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            config_dir: Mutex::new(None),
        }
    }
}

impl PersistenceConfig {
    /// Set the config directory path.
    pub fn set_config_dir(&self, path: PathBuf) {
        *self.config_dir.lock().unwrap() = Some(path);
    }

    /// Get the config directory path (public version for HTTP server).
    pub fn get_config_dir_public(&self) -> Option<PathBuf> {
        self.config_dir.lock().unwrap().clone()
    }

    /// Get the config directory path.
    fn get_config_dir(&self) -> Result<PathBuf, String> {
        self.config_dir
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Config directory not set".to_string())
    }

    /// Get the chats directory for a project/workspace.
    fn get_chat_dir(&self, project_name: &str, workspace_name: &str) -> Result<PathBuf, String> {
        Ok(self
            .get_config_dir()?
            .join("chats")
            .join(project_name)
            .join(workspace_name))
    }
}

// ============================================================================
// Chat Commands
// ============================================================================

/// Save a chat file.
#[tauri::command]
pub fn save_chat(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat: ChatFile,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::save_chat(&dir, &chat).map_err(|e| e.to_string())
}

/// Load a chat file.
#[tauri::command]
pub fn load_chat(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<ChatFile, String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::load_chat(&dir, &chat_id).map_err(|e| e.to_string())
}

/// Delete a chat file.
#[tauri::command]
pub fn delete_chat(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::delete_chat(&dir, &chat_id).map_err(|e| e.to_string())
}

/// List all chat IDs in a workspace.
#[tauri::command]
pub fn list_chat_ids(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
) -> Result<Vec<String>, String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::list_chat_ids(&dir).map_err(|e| e.to_string())
}

/// Migrate legacy `{chat_id}.json` to JSONL + metadata if needed.
#[tauri::command]
pub fn migrate_chat_if_needed(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<bool, String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::migrate_chat_if_needed(&dir, &chat_id).map_err(|e| e.to_string())
}

// ============================================================================
// Chat Index Commands
// ============================================================================

/// Save the chat index.
#[tauri::command]
pub fn save_chat_index(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    index: ChatIndex,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::save_chat_index(&dir, &index).map_err(|e| e.to_string())
}

/// Load the chat index.
#[tauri::command]
pub fn load_chat_index(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
) -> Result<ChatIndex, String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    let index = persistence::load_chat_index(&dir).map_err(|e| e.to_string())?;

    for entry in &index.chats {
        if let Err(err) = persistence::migrate_chat_if_needed(&dir, &entry.id) {
            eprintln!(
                "Failed to migrate chat {} in {}/{}: {}",
                entry.id, project_name, workspace_name, err
            );
        }
    }

    Ok(index)
}

/// Add or update a chat entry in the index and save.
#[tauri::command]
pub fn upsert_chat_entry(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    entry: ChatIndexEntry,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    let mut index = persistence::load_chat_index(&dir).map_err(|e| e.to_string())?;
    persistence::upsert_chat_entry(&mut index, entry);
    persistence::save_chat_index(&dir, &index).map_err(|e| e.to_string())
}

/// Remove a chat entry from the index and save.
#[tauri::command]
pub fn remove_chat_entry(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    let mut index = persistence::load_chat_index(&dir).map_err(|e| e.to_string())?;
    persistence::remove_chat_entry(&mut index, &chat_id);
    persistence::save_chat_index(&dir, &index).map_err(|e| e.to_string())
}

// ============================================================================
// Workspace State Commands
// ============================================================================

/// Save workspace state.
#[tauri::command]
pub fn save_workspace_state(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    workspace_state: WorkspaceState,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::save_workspace_state(&dir, &workspace_state).map_err(|e| e.to_string())
}

/// Load workspace state.
#[tauri::command]
pub fn load_workspace_state(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
) -> Result<WorkspaceState, String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    persistence::load_workspace_state(&dir).map_err(|e| e.to_string())
}

// ============================================================================
// Project Registry Commands
// ============================================================================

/// Save the project registry.
#[tauri::command]
pub fn save_project_registry(
    state: State<PersistenceConfig>,
    registry: ProjectRegistry,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    persistence::save_project_registry(&dir, &registry).map_err(|e| e.to_string())
}

/// Load the project registry.
#[tauri::command]
pub fn load_project_registry(state: State<PersistenceConfig>) -> Result<ProjectRegistry, String> {
    let dir = state.get_config_dir()?;
    persistence::load_project_registry(&dir).map_err(|e| e.to_string())
}

/// Add or update a project and save.
#[tauri::command]
pub fn upsert_project(
    state: State<PersistenceConfig>,
    project: Project,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    let mut registry = persistence::load_project_registry(&dir).map_err(|e| e.to_string())?;
    persistence::upsert_project(&mut registry, project);
    persistence::save_project_registry(&dir, &registry).map_err(|e| e.to_string())
}

/// Remove a project and save.
#[tauri::command]
pub fn remove_project(state: State<PersistenceConfig>, project_id: String) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    let mut registry = persistence::load_project_registry(&dir).map_err(|e| e.to_string())?;
    persistence::remove_project(&mut registry, &project_id);
    persistence::save_project_registry(&dir, &registry).map_err(|e| e.to_string())
}

// ============================================================================
// Config Commands (for ConfigStore)
// ============================================================================

/// Generic JSON config file save.
/// Used for config.json and history.json.
#[tauri::command]
pub fn save_json_config(
    state: State<PersistenceConfig>,
    filename: String,
    content: serde_json::Value,
) -> Result<(), String> {
    let dir = state.get_config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(&filename);
    let temp_path = dir.join(format!("{}.tmp", filename));

    let json = serde_json::to_string_pretty(&content).map_err(|e| e.to_string())?;
    std::fs::write(&temp_path, format!("{}\n", json)).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &file_path).map_err(|e| e.to_string())?;

    Ok(())
}

/// Generic JSON config file load.
#[tauri::command]
pub fn load_json_config(
    state: State<PersistenceConfig>,
    filename: String,
) -> Result<Option<serde_json::Value>, String> {
    let dir = state.get_config_dir()?;
    let file_path = dir.join(&filename);

    if !file_path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    Ok(Some(value))
}

/// Check if a config file exists.
#[tauri::command]
pub fn config_file_exists(state: State<PersistenceConfig>, filename: String) -> Result<bool, String> {
    let dir = state.get_config_dir()?;
    Ok(dir.join(&filename).exists())
}

/// Get the config directory path.
#[tauri::command]
pub fn get_config_dir(state: State<PersistenceConfig>) -> Result<String, String> {
    state
        .get_config_dir()
        .map(|p| p.to_string_lossy().to_string())
}

// ============================================================================
// Archive Operations (for WorkspaceStore)
// ============================================================================

/// Archive a chat directory by moving it.
#[tauri::command]
pub fn archive_chat_dir(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    archive_name: String,
) -> Result<(), String> {
    let chats_dir = state.get_config_dir()?.join("chats").join(&project_name);
    let source = chats_dir.join(&workspace_name);
    let archive_parent = chats_dir.join("archived");
    let dest = archive_parent.join(&archive_name);

    if !source.exists() {
        return Ok(()); // Nothing to archive
    }

    std::fs::create_dir_all(&archive_parent).map_err(|e| e.to_string())?;
    std::fs::rename(&source, &dest).map_err(|e| e.to_string())?;

    Ok(())
}

/// Create a directory if it doesn't exist.
#[tauri::command]
pub fn ensure_chat_dir(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

/// Remove a single chat file.
#[tauri::command]
pub fn remove_chat_file(
    state: State<PersistenceConfig>,
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<(), String> {
    let dir = state.get_chat_dir(&project_name, &workspace_name)?;
    let file_path = dir.join(format!("{}.json", chat_id));

    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}
