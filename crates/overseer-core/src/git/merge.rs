//! Git merge operations.
//!
//! # Overview
//!
//! This module provides functions to check and perform merges between
//! branches. Overseer's workflow typically involves:
//!
//! 1. Work on a feature branch in a workspace
//! 2. Check if the branch can be cleanly merged
//! 3. Merge into the default branch (main/master)
//!
//! # Key Operations
//!
//! - [`check_merge`] - Check if a merge would succeed (dry run)
//! - [`merge_into_main`] - Actually perform the merge
//!
//! # Merge Strategies
//!
//! The module detects different merge scenarios:
//!
//! - **Fast-forward**: Default branch hasn't diverged; simple pointer update
//! - **Clean merge**: Branches diverged but no conflicts
//! - **Conflict**: Changes overlap and need manual resolution
//!
//! # Safety
//!
//! When merges fail due to conflicts, the module automatically aborts
//! the merge to leave the repository in a clean state.

use super::{get_current_branch, get_default_branch, run_git, GitError};
use serde::Serialize;
use std::path::Path;

// ============================================================================
// TYPES
// ============================================================================

/// Result of a merge check or merge operation.
///
/// Indicates whether the merge succeeded or failed, and provides
/// details about any conflicts.
#[derive(Debug, Clone, Serialize)]
pub struct MergeResult {
    /// Whether the merge succeeded (or would succeed for check_merge)
    pub success: bool,

    /// List of conflicting files or conflict descriptions
    ///
    /// Empty if no conflicts.
    pub conflicts: Vec<String>,

    /// Human-readable message describing the result
    pub message: String,
}

// ============================================================================
// CHECKING MERGES
// ============================================================================

/// Check if a merge would succeed without actually performing it.
///
/// Uses `git merge-tree` to simulate the merge and detect conflicts
/// without modifying any files.
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace (must be on feature branch)
///
/// # Returns
///
/// A `MergeResult` indicating:
/// - `success: true` if merge would succeed (fast-forward or clean)
/// - `success: false` if there would be conflicts
/// - `conflicts`: List of conflicting file paths
///
/// # Scenarios Detected
///
/// 1. **On default branch**: Returns failure (nothing to merge)
/// 2. **Fast-forward possible**: Default branch is ancestor of feature
/// 3. **Clean merge**: Branches diverged but no conflicts
/// 4. **Conflicts**: Overlapping changes detected
///
/// # Example
///
/// ```ignore
/// let result = check_merge(workspace_path)?;
/// if result.success {
///     println!("Merge would succeed: {}", result.message);
/// } else if !result.conflicts.is_empty() {
///     println!("Conflicts in: {:?}", result.conflicts);
/// }
/// ```
pub fn check_merge(workspace_path: &Path) -> Result<MergeResult, GitError> {
    // Get current branch (the feature branch)
    let feature_branch = get_current_branch(workspace_path)?;

    // Check if already on default branch
    if feature_branch == "main" || feature_branch == "master" {
        return Ok(MergeResult {
            success: false,
            conflicts: vec![],
            message: "Already on the default branch, nothing to merge.".to_string(),
        });
    }

    // Get default branch, stripping origin/ prefix if present
    let default_remote = get_default_branch(workspace_path);
    let default_branch = default_remote
        .strip_prefix("origin/")
        .unwrap_or(&default_remote)
        .to_string();

    // Check if fast-forward is possible
    // (default branch is an ancestor of feature branch)
    let is_ancestor = run_git(
        &[
            "merge-base",
            "--is-ancestor",
            &default_branch,
            &feature_branch,
        ],
        workspace_path,
    )?;

    if is_ancestor.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!(
                "Clean fast-forward merge of '{feature_branch}' into '{default_branch}'."
            ),
        });
    }

    // Use merge-tree to simulate merge and check for conflicts
    // This doesn't modify any files - it's a pure tree comparison
    let merge_tree = run_git(
        &[
            "merge-tree",
            "--write-tree",
            &default_branch,
            &feature_branch,
        ],
        workspace_path,
    )?;

    if merge_tree.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!("Clean merge of '{feature_branch}' into '{default_branch}'."),
        });
    }

    // Merge would have conflicts - extract conflicting file names
    let mt_stdout = String::from_utf8_lossy(&merge_tree.stdout);

    // merge-tree output includes conflict markers with file paths
    // Format includes tab-separated fields with file path at the end
    let conflicts: Vec<String> = mt_stdout
        .lines()
        .filter(|l| l.contains('\t'))
        .filter_map(|l| l.split('\t').next_back().map(|s| s.to_string()))
        .collect();

    Ok(MergeResult {
        success: false,
        conflicts,
        message: format!(
            "Merge of '{feature_branch}' into '{default_branch}' has conflicts that need resolution."
        ),
    })
}

// ============================================================================
// PERFORMING MERGES
// ============================================================================

/// Merge the current branch into the default branch.
///
/// Finds the workspace checked out on the default branch and performs
/// the merge there. This preserves the feature branch workspace.
///
/// # Arguments
///
/// * `workspace_path` - Path to the feature branch workspace
///
/// # Process
///
/// 1. Identifies the current feature branch
/// 2. Finds the workspace on the default branch (main/master)
/// 3. Runs `git merge <feature-branch>` from that workspace
/// 4. Aborts if conflicts occur (leaves repo clean)
///
/// # Returns
///
/// A `MergeResult` indicating:
/// - `success: true` if merge completed
/// - `success: false` if conflicts occurred (merge aborted)
///
/// # Errors
///
/// Returns an error if:
/// - Already on the default branch
/// - No workspace exists on the default branch
/// - Git merge command fails for non-conflict reasons
///
/// # Safety
///
/// If the merge fails due to conflicts, the function automatically
/// runs `git merge --abort` to leave the main workspace clean.
pub fn merge_into_main(workspace_path: &Path) -> Result<MergeResult, GitError> {
    // Get current branch (the feature branch)
    let feature_branch = get_current_branch(workspace_path)?;

    // Check if already on default branch
    if feature_branch == "main" || feature_branch == "master" {
        return Ok(MergeResult {
            success: false,
            conflicts: vec![],
            message: "Already on the default branch, nothing to merge.".to_string(),
        });
    }

    // Get default branch name (without origin/ prefix)
    let default_remote = get_default_branch(workspace_path);
    let default_branch = default_remote
        .strip_prefix("origin/")
        .unwrap_or(&default_remote)
        .to_string();

    // Find the workspace checked out on the default branch
    // We need to run the merge FROM that workspace
    let wt_output = run_git(&["worktree", "list", "--porcelain"], workspace_path)?;
    let wt_stdout = String::from_utf8_lossy(&wt_output.stdout);

    let mut main_workspace_path: Option<String> = None;
    let mut current_wt_path = String::new();

    // Parse worktree list to find main branch workspace
    for line in wt_stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_wt_path = path.to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if branch == default_branch {
                main_workspace_path = Some(current_wt_path.clone());
            }
        } else if line.is_empty() {
            current_wt_path.clear();
        }
    }

    let main_path = match main_workspace_path {
        Some(path) => path,
        None => {
            return Err(GitError::Other(format!(
                "Could not find a workspace checked out on '{default_branch}'. \
                 Make sure the main branch has a workspace."
            )));
        }
    };

    let main_path = Path::new(&main_path);

    // Perform the merge from the main branch workspace
    let merge_output = run_git(
        &[
            "merge",
            &feature_branch,
            "--no-edit",
            "-m",
            &format!("Merge branch '{feature_branch}'"),
        ],
        main_path,
    )?;

    if merge_output.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: format!("Successfully merged '{feature_branch}' into '{default_branch}'."),
        });
    }

    // Merge failed - check if due to conflicts
    let stderr = String::from_utf8_lossy(&merge_output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&merge_output.stdout).to_string();

    // Extract conflict descriptions from output
    let conflicts: Vec<String> = stdout
        .lines()
        .filter(|l| l.starts_with("CONFLICT"))
        .map(|l| l.to_string())
        .collect();

    // Abort the merge to leave the repository clean
    let _ = run_git(&["merge", "--abort"], main_path);

    if !conflicts.is_empty() {
        return Ok(MergeResult {
            success: false,
            conflicts,
            message: format!(
                "Merge of '{feature_branch}' into '{default_branch}' has conflicts that need resolution."
            ),
        });
    }

    // Non-conflict failure
    Ok(MergeResult {
        success: false,
        conflicts: vec![],
        message: format!("Merge failed: {stderr} {stdout}"),
    })
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_result_serializes() {
        let result = MergeResult {
            success: true,
            conflicts: vec![],
            message: "Clean merge".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("Clean merge"));
    }

    #[test]
    fn merge_result_with_conflicts_serializes() {
        let result = MergeResult {
            success: false,
            conflicts: vec!["file1.rs".to_string(), "file2.rs".to_string()],
            message: "Has conflicts".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("file1.rs"));
        assert!(json.contains("file2.rs"));
    }

    #[test]
    fn parse_conflict_output() {
        // Simulate merge-tree conflict output parsing
        let output = "100644 abc def 1\tpath/to/file1.rs\n100644 ghi jkl 2\tpath/to/file2.rs";

        let conflicts: Vec<String> = output
            .lines()
            .filter(|l| l.contains('\t'))
            .filter_map(|l| l.split('\t').next_back().map(|s| s.to_string()))
            .collect();

        assert_eq!(conflicts.len(), 2);
        assert_eq!(conflicts[0], "path/to/file1.rs");
        assert_eq!(conflicts[1], "path/to/file2.rs");
    }

    #[test]
    fn parse_merge_stdout_conflicts() {
        // Simulate stdout from failed merge
        let stdout = "Auto-merging file.rs\nCONFLICT (content): Merge conflict in file.rs\nCONFLICT (content): Merge conflict in other.rs\nAutomatic merge failed";

        let conflicts: Vec<String> = stdout
            .lines()
            .filter(|l| l.starts_with("CONFLICT"))
            .map(|l| l.to_string())
            .collect();

        assert_eq!(conflicts.len(), 2);
        assert!(conflicts[0].contains("file.rs"));
        assert!(conflicts[1].contains("other.rs"));
    }

    // Note: Integration tests for check_merge and merge_into_main require
    // a real git repository with multiple branches and worktrees.
}
