//! Git operations for Tauri commands.
//!
//! This module provides thin async wrappers around `overseer_core::git` functions.
//! Since the core functions are already async, these wrappers simply call them directly.

use crate::agents::build_login_shell_command;
use ignore::WalkBuilder;
use serde::Serialize;
use std::path::Path;

// Re-export types from overseer-core for use by Tauri commands
pub use overseer_core::git::{ChangedFilesResult, MergeResult, WorkspaceInfo};

// ============================================================================
// ASYNC WRAPPERS
// ============================================================================

/// List all worktrees in a repository.
#[tauri::command]
pub async fn list_workspaces(repo_path: String) -> Result<Vec<WorkspaceInfo>, String> {
    let path = std::path::PathBuf::from(&repo_path);
    overseer_core::git::list_workspaces(&path)
        .await
        .map_err(|e| e.to_string())
}

/// List all changed files in a workspace.
#[tauri::command]
pub async fn list_changed_files(workspace_path: String) -> Result<ChangedFilesResult, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::list_changed_files(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Add a new workspace (worktree) for a branch.
#[tauri::command]
pub async fn add_workspace(repo_path: String, branch: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(&repo_path);
    overseer_core::git::add_workspace(&path, &branch)
        .await
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Remove a workspace (worktree) from the repository.
#[tauri::command]
pub async fn archive_workspace(repo_path: String, workspace_path: String) -> Result<(), String> {
    let repo = std::path::PathBuf::from(&repo_path);
    let workspace = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::archive_workspace(&repo, &workspace)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a merge would succeed without actually performing it.
#[tauri::command]
pub async fn check_merge(workspace_path: String) -> Result<MergeResult, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::check_merge(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Merge the current branch into the default branch.
#[tauri::command]
pub async fn merge_into_main(workspace_path: String) -> Result<MergeResult, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::merge_into_main(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Rename the current branch.
#[tauri::command]
pub async fn rename_branch(workspace_path: String, new_name: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::rename_branch(&path, &new_name)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a branch from the repository.
#[tauri::command]
pub async fn delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&repo_path);
    overseer_core::git::delete_branch(&path, &branch_name)
        .await
        .map_err(|e| e.to_string())
}

/// Get the diff for a specific file (branch changes).
#[tauri::command]
pub async fn get_file_diff(
    workspace_path: String,
    file_path: String,
    file_status: String,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::get_file_diff(&path, &file_path, &file_status)
        .await
        .map_err(|e| e.to_string())
}

/// Get the diff for uncommitted changes to a file.
#[tauri::command]
pub async fn get_uncommitted_diff(
    workspace_path: String,
    file_path: String,
    file_status: String,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    overseer_core::git::get_uncommitted_diff(&path, &file_path, &file_status)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a path is inside a git repository.
#[tauri::command]
pub async fn is_git_repo(path: String) -> bool {
    Path::new(&path).join(".git").exists()
}

// ============================================================================
// PR STATUS (uses gh CLI, not in overseer-core)
// ============================================================================

#[derive(Serialize)]
pub struct PrStatus {
    pub number: i64,
    pub state: String,
    pub url: String,
    pub is_draft: bool,
}

#[tauri::command]
pub async fn get_pr_status(
    workspace_path: String,
    branch: String,
    agent_shell: Option<String>,
) -> Result<Option<PrStatus>, String> {
    let args = vec![
        "pr".to_string(),
        "view".to_string(),
        branch,
        "--json".to_string(),
        "number,state,url,isDraft".to_string(),
    ];

    let mut cmd =
        build_login_shell_command("gh", &args, Some(&workspace_path), agent_shell.as_deref())?;

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run gh: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse gh output: {e}"))?;

    Ok(Some(PrStatus {
        number: parsed["number"].as_i64().unwrap_or(0),
        state: parsed["state"].as_str().unwrap_or("OPEN").to_string(),
        url: parsed["url"].as_str().unwrap_or("").to_string(),
        is_draft: parsed["isDraft"].as_bool().unwrap_or(false),
    }))
}

// ============================================================================
// FILE LISTING (uses ignore crate, not in overseer-core)
// ============================================================================

/// List all files in a directory, respecting .gitignore.
/// Returns relative paths from the workspace root.
#[tauri::command]
pub async fn list_files(workspace_path: String) -> Result<Vec<String>, String> {
    // This still needs spawn_blocking since the ignore crate is sync
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let root = Path::new(&workspace_path);

        let walker = WalkBuilder::new(&workspace_path)
            .hidden(false) // Include hidden files
            .git_ignore(true) // Respect .gitignore
            .git_global(true) // Respect global gitignore
            .git_exclude(true) // Respect .git/info/exclude
            .build();

        for entry in walker {
            match entry {
                Ok(e) => {
                    if e.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                        if let Ok(rel) = e.path().strip_prefix(root) {
                            files.push(rel.to_string_lossy().to_string());
                        }
                    }
                }
                Err(_) => continue,
            }
        }

        files.sort();
        Ok(files)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_status_serializes() {
        let status = PrStatus {
            number: 42,
            state: "OPEN".to_string(),
            url: "https://github.com/org/repo/pull/42".to_string(),
            is_draft: false,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"number\":42"));
        assert!(json.contains("\"state\":\"OPEN\""));
        assert!(json.contains("\"is_draft\":false"));
    }

    // Note: Most git tests are now in overseer-core.
    // Tests here focus on Tauri-specific functionality (PR status, file listing).
}
