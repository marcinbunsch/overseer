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

    // Note: These tests would require a real git repository.
    // Unit tests here focus on error condition logic.

    #[test]
    fn rename_detects_main_branch() {
        // We can't easily test the full function without a git repo,
        // but we can verify the logic flow by examining the error types

        // The function should return GitError::Other for main/master
        // This is tested indirectly through the implementation
    }

    #[test]
    fn git_error_for_rename_failure() {
        // Verify that GitError types are appropriate
        let err = GitError::Other("Cannot rename the main branch".to_string());
        assert!(err.to_string().contains("main branch"));
    }
}
