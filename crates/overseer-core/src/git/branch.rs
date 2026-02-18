//! Git branch operations.
//!
//! # Overview
//!
//! This module provides functions for managing git branches:
//!
//! - [`rename_branch`] - Rename the current branch
//! - [`delete_branch`] - Delete a branch from the repository
//!
//! # Safety
//!
//! The module prevents dangerous operations:
//!
//! - Cannot rename the default branch (main/master)
//! - Delete uses `-d` (safe delete) which fails if unmerged commits exist
//!
//! To force-delete an unmerged branch, use git directly with `-D`.

use super::{get_current_branch, run_git_success, GitError};
use std::path::Path;

// ============================================================================
// BRANCH OPERATIONS
// ============================================================================

/// Rename the current branch.
///
/// Changes the name of the currently checked-out branch to a new name.
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace (git worktree)
/// * `new_name` - The new branch name
///
/// # Safety
///
/// Refuses to rename the default branch (main/master) to prevent
/// accidentally breaking repository conventions.
///
/// # Errors
///
/// Returns an error if:
/// - Currently on main or master branch
/// - The new name already exists
/// - Invalid branch name
///
/// # Example
///
/// ```ignore
/// // Rename current branch from "old-feature" to "new-feature"
/// rename_branch(workspace_path, "new-feature").await?;
/// ```
pub async fn rename_branch(workspace_path: &Path, new_name: &str) -> Result<(), GitError> {
    // Check current branch
    let current_branch = get_current_branch(workspace_path).await?;

    // Prevent renaming main/master
    if current_branch == "main" || current_branch == "master" {
        return Err(GitError::Other("Cannot rename the main branch".to_string()));
    }

    // Rename using git branch -m
    run_git_success(&["branch", "-m", new_name], workspace_path).await?;

    Ok(())
}

/// Delete a branch from the repository.
///
/// Removes a branch reference. Uses safe delete (`-d`) which fails
/// if the branch has unmerged commits.
///
/// # Arguments
///
/// * `repo_path` - Path to the repository (or any worktree)
/// * `branch_name` - Name of the branch to delete
///
/// # Safety
///
/// Uses `-d` (lowercase) for safe deletion:
/// - Fails if branch has unmerged commits
/// - Fails if trying to delete the current branch
///
/// To force-delete, use git directly with `-D`.
///
/// # Errors
///
/// Returns an error if:
/// - Branch doesn't exist
/// - Branch has unmerged commits (use `-D` manually if intended)
/// - Currently checked out on that branch
///
/// # Example
///
/// ```ignore
/// // Delete a merged feature branch
/// delete_branch(repo_path, "feature-done").await?;
/// ```
pub async fn delete_branch(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    run_git_success(&["branch", "-d", branch_name], repo_path).await?;
    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::tempdir;

    /// Create an isolated git repository for testing.
    fn init_temp_repo(branch_name: &str) -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        let path = dir.path();

        // Use GIT_CONFIG_GLOBAL to isolate from user's global config
        let empty_config = path.join(".gitconfig-empty");
        std::fs::write(&empty_config, "").unwrap();

        Command::new("git")
            .args(["init", "-b", branch_name])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        // Need at least one commit so HEAD is valid
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .current_dir(path)
            .output()
            .unwrap();

        dir
    }

    #[test]
    fn git_error_for_rename_failure() {
        let err = GitError::Other("Cannot rename the main branch".to_string());
        assert!(err.to_string().contains("main branch"));
    }

    #[tokio::test]
    async fn rename_branch_blocks_main() {
        let dir = init_temp_repo("main");
        let result = rename_branch(dir.path(), "new-name").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("main branch"));
    }

    #[tokio::test]
    async fn rename_branch_blocks_master() {
        let dir = init_temp_repo("master");
        let result = rename_branch(dir.path(), "new-name").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("main branch"));
    }

    #[tokio::test]
    async fn rename_branch_allows_feature_branch() {
        let dir = init_temp_repo("feature-branch");
        let result = rename_branch(dir.path(), "renamed-branch").await;
        assert!(result.is_ok());

        let output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(branch, "renamed-branch");
    }

    #[tokio::test]
    async fn delete_branch_removes_merged_branch() {
        let dir = init_temp_repo("main");
        let path = dir.path();

        // Create and checkout a feature branch
        Command::new("git")
            .args(["checkout", "-b", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();

        // Make a commit on feature branch
        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "feature commit"])
            .current_dir(path)
            .output()
            .unwrap();

        // Switch back to main and merge
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["merge", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();

        // Now delete the branch
        let result = delete_branch(path, "feature-to-delete").await;
        assert!(result.is_ok());

        // Verify branch no longer exists
        let output = Command::new("git")
            .args(["branch", "--list", "feature-to-delete"])
            .current_dir(path)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).trim().is_empty());
    }

    #[tokio::test]
    async fn delete_branch_fails_for_unmerged_branch() {
        let dir = init_temp_repo("main");
        let path = dir.path();

        // Create a feature branch with unmerged changes
        Command::new("git")
            .args(["checkout", "-b", "unmerged-feature"])
            .current_dir(path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["commit", "--allow-empty", "-m", "unmerged commit"])
            .current_dir(path)
            .output()
            .unwrap();

        // Switch back to main (don't merge)
        Command::new("git")
            .args(["checkout", "main"])
            .current_dir(path)
            .output()
            .unwrap();

        // Try to delete - should fail with -d (safe delete)
        let result = delete_branch(path, "unmerged-feature").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_branch_fails_for_nonexistent_branch() {
        let dir = init_temp_repo("main");
        let result = delete_branch(dir.path(), "nonexistent-branch").await;
        assert!(result.is_err());
    }
}
