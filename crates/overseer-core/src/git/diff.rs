//! Git diff operations.
//!
//! # Overview
//!
//! This module provides functions to query changed files and get diffs
//! in git workspaces. It distinguishes between:
//!
//! - **Branch changes**: Committed changes compared to the default branch
//! - **Uncommitted changes**: Staged and unstaged changes vs HEAD
//!
//! # Key Operations
//!
//! - [`list_changed_files`] - Get all changed files in a workspace
//! - [`get_file_diff`] - Get the diff for a specific file (branch changes)
//! - [`get_uncommitted_diff`] - Get the diff for uncommitted changes
//!
//! # File Status Codes
//!
//! Files are tagged with a status code from git:
//!
//! | Code | Meaning |
//! |------|---------|
//! | `A`  | Added   |
//! | `M`  | Modified|
//! | `D`  | Deleted |
//! | `R`  | Renamed |
//! | `?`  | Untracked (not in git) |

use super::{get_current_branch, get_default_branch, run_git, GitError};
use serde::Serialize;
use std::path::Path;

// ============================================================================
// TYPES
// ============================================================================

/// A file that has been changed.
///
/// Represents a single file change with its status and path.
#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    /// Status code: A (added), M (modified), D (deleted), R (renamed), ? (untracked)
    pub status: String,

    /// Path to the file, relative to the workspace root
    pub path: String,
}

/// Result of listing changed files.
///
/// Separates branch changes (committed) from uncommitted changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFilesResult {
    /// Files changed compared to the default branch (committed changes)
    pub files: Vec<ChangedFile>,

    /// Uncommitted changes (staged + unstaged + untracked)
    pub uncommitted: Vec<ChangedFile>,

    /// Whether the workspace is on the default branch (main/master)
    pub is_default_branch: bool,
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

/// Parse the output of `git diff --name-status`.
///
/// The format is:
/// ```text
/// M\tpath/to/modified.rs
/// A\tpath/to/added.rs
/// D\tpath/to/deleted.rs
/// ```
///
/// # Arguments
///
/// * `stdout` - The stdout from a `git diff --name-status` command
///
/// # Returns
///
/// Vector of `ChangedFile` parsed from the output.
pub fn parse_diff_name_status(stdout: &str) -> Vec<ChangedFile> {
    let mut files = Vec::new();

    for line in stdout.lines() {
        // Split on tab: "M\tpath/to/file"
        let parts: Vec<&str> = line.splitn(2, '\t').collect();
        if parts.len() == 2 {
            files.push(ChangedFile {
                // Take first character of status (handles R100, C50, etc.)
                status: parts[0].chars().next().unwrap_or('?').to_string(),
                path: parts[1].to_string(),
            });
        }
    }

    files
}

// ============================================================================
// LISTING CHANGED FILES
// ============================================================================

/// List all changed files in a workspace.
///
/// Returns both committed changes (compared to default branch) and
/// uncommitted changes (compared to HEAD).
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace directory
///
/// # Returns
///
/// A `ChangedFilesResult` with:
/// - `files`: Changes committed to this branch vs default branch
/// - `uncommitted`: Staged, unstaged, and untracked changes
/// - `is_default_branch`: Whether on main/master
///
/// # Branch Detection
///
/// The function automatically detects the default branch (main, master,
/// origin/main, origin/master) and uses `git merge-base` to find the
/// common ancestor for comparison.
///
/// # Sorting
///
/// - Branch changes (`files`) are sorted alphabetically by path
/// - Uncommitted changes are sorted with tracked changes first, then
///   untracked files, both groups sorted alphabetically
pub fn list_changed_files(workspace_path: &Path) -> Result<ChangedFilesResult, GitError> {
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut uncommitted: Vec<ChangedFile> = Vec::new();

    // Get current branch
    let current_branch = get_current_branch(workspace_path)?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    // === Uncommitted changes (staged + unstaged against HEAD) ===
    let uncommitted_output = run_git(&["diff", "--name-status", "HEAD"], workspace_path)?;
    uncommitted.extend(parse_diff_name_status(&String::from_utf8_lossy(
        &uncommitted_output.stdout,
    )));

    // Include untracked files in uncommitted
    let untracked = run_git(
        &["ls-files", "--others", "--exclude-standard"],
        workspace_path,
    )?;

    let untracked_stdout = String::from_utf8_lossy(&untracked.stdout);
    for line in untracked_stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            uncommitted.push(ChangedFile {
                status: "?".to_string(),
                path: trimmed.to_string(),
            });
        }
    }

    // Sort uncommitted: tracked changes first (alphabetical), then untracked
    uncommitted.sort_by(|a, b| {
        let a_untracked = a.status == "?";
        let b_untracked = b.status == "?";
        a_untracked.cmp(&b_untracked).then(a.path.cmp(&b.path))
    });

    // === Branch changes (committed changes vs default branch) ===
    if !is_default_branch {
        let default_branch = get_default_branch(workspace_path);

        // Find the merge base (common ancestor)
        let merge_base = run_git(&["merge-base", "HEAD", &default_branch], workspace_path)?;

        if merge_base.status.success() {
            let base_ref = String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string();

            // Diff from merge-base to HEAD (committed changes only)
            let output = run_git(
                &["diff", "--name-status", &base_ref, "HEAD"],
                workspace_path,
            )?;

            files.extend(parse_diff_name_status(&String::from_utf8_lossy(
                &output.stdout,
            )));

            // Sort branch changes alphabetically
            files.sort_by(|a, b| a.path.cmp(&b.path));
        }
    }

    Ok(ChangedFilesResult {
        files,
        uncommitted,
        is_default_branch,
    })
}

// ============================================================================
// FILE DIFFS
// ============================================================================

/// Get the diff for a specific file.
///
/// Returns the diff comparing the file to the appropriate base:
/// - For branch files: diff from merge-base to HEAD
/// - For untracked/new files: diff against /dev/null (shows full content)
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace
/// * `file_path` - Path to the file (relative to workspace root)
/// * `file_status` - Status code from [`ChangedFile::status`]
///
/// # Returns
///
/// The diff output as a string in unified diff format.
///
/// # Special Cases
///
/// - Untracked files (`?`): Uses `git diff --no-index /dev/null <file>`
/// - Added files (`A`): Same as untracked
/// - Other statuses: Uses standard diff against merge-base or HEAD
pub fn get_file_diff(
    workspace_path: &Path,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    // Untracked and newly added files: diff against /dev/null
    if file_status == "?" || file_status == "A" {
        let output = run_git(
            &["diff", "--no-index", "/dev/null", file_path],
            workspace_path,
        )?;

        // Note: git diff --no-index exits with 1 when files differ (expected)
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // Get current branch to determine base ref
    let current_branch = get_current_branch(workspace_path)?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    let base_ref = if is_default_branch {
        "HEAD".to_string()
    } else {
        let default_branch = get_default_branch(workspace_path);

        // Get merge-base for comparison
        let merge_base = run_git(&["merge-base", "HEAD", &default_branch], workspace_path)?;

        if merge_base.status.success() {
            String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string()
        } else {
            "HEAD".to_string()
        }
    };

    let output = run_git(&["diff", &base_ref, "--", file_path], workspace_path)?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get the diff for uncommitted changes to a file.
///
/// Shows changes that haven't been committed yet (staged + unstaged vs HEAD).
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace
/// * `file_path` - Path to the file (relative to workspace root)
/// * `file_status` - Status code from [`ChangedFile::status`]
///
/// # Returns
///
/// The diff output as a string in unified diff format.
///
/// # Difference from [`get_file_diff`]
///
/// - [`get_file_diff`]: Shows committed changes compared to default branch
/// - [`get_uncommitted_diff`]: Shows uncommitted changes compared to HEAD
pub fn get_uncommitted_diff(
    workspace_path: &Path,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    // Untracked files: diff against /dev/null
    if file_status == "?" {
        let output = run_git(
            &["diff", "--no-index", "/dev/null", file_path],
            workspace_path,
        )?;

        // Note: exit code 1 is expected when files differ
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // Diff against HEAD for uncommitted changes
    let output = run_git(&["diff", "HEAD", "--", file_path], workspace_path)?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------------
    // Parsing Tests
    // ------------------------------------------------------------------------

    #[test]
    fn parse_diff_name_status_basic() {
        let output = "M\tsrc/main.rs\nA\tsrc/new.rs\nD\tsrc/deleted.rs";
        let files = parse_diff_name_status(output);

        assert_eq!(files.len(), 3);

        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].path, "src/main.rs");

        assert_eq!(files[1].status, "A");
        assert_eq!(files[1].path, "src/new.rs");

        assert_eq!(files[2].status, "D");
        assert_eq!(files[2].path, "src/deleted.rs");
    }

    #[test]
    fn parse_diff_name_status_rename() {
        // Rename shows as R100 (100% match) or similar
        let output = "R100\told/path.rs\tnew/path.rs";
        let files = parse_diff_name_status(output);

        // Our parser takes the first character, so R100 becomes R
        // The path will be "old/path.rs\tnew/path.rs" due to splitn(2)
        // This is a simplification - for accurate rename handling,
        // we'd need to use -M flag and parse differently
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "R");
    }

    #[test]
    fn parse_diff_name_status_empty() {
        let output = "";
        let files = parse_diff_name_status(output);

        assert!(files.is_empty());
    }

    #[test]
    fn parse_diff_name_status_with_spaces() {
        let output = "M\tpath/with spaces/file.rs";
        let files = parse_diff_name_status(output);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "path/with spaces/file.rs");
    }

    // ------------------------------------------------------------------------
    // Type Tests
    // ------------------------------------------------------------------------

    #[test]
    fn changed_file_serializes() {
        let file = ChangedFile {
            status: "M".to_string(),
            path: "src/lib.rs".to_string(),
        };

        let json = serde_json::to_string(&file).unwrap();
        assert!(json.contains("\"status\":\"M\""));
        assert!(json.contains("src/lib.rs"));
    }

    #[test]
    fn changed_files_result_uses_camel_case() {
        let result = ChangedFilesResult {
            files: vec![],
            uncommitted: vec![],
            is_default_branch: true,
        };

        let json = serde_json::to_string(&result).unwrap();
        // Should use camelCase for TypeScript compatibility
        assert!(json.contains("isDefaultBranch"));
    }

    // ------------------------------------------------------------------------
    // Sorting Tests
    // ------------------------------------------------------------------------

    #[test]
    fn uncommitted_sorting_tracked_before_untracked() {
        let mut files = vec![
            ChangedFile {
                status: "?".to_string(),
                path: "aaa.txt".to_string(),
            },
            ChangedFile {
                status: "M".to_string(),
                path: "zzz.txt".to_string(),
            },
            ChangedFile {
                status: "?".to_string(),
                path: "bbb.txt".to_string(),
            },
            ChangedFile {
                status: "A".to_string(),
                path: "ccc.txt".to_string(),
            },
        ];

        // Sort like list_changed_files does
        files.sort_by(|a, b| {
            let a_untracked = a.status == "?";
            let b_untracked = b.status == "?";
            a_untracked.cmp(&b_untracked).then(a.path.cmp(&b.path))
        });

        // Tracked files first (alphabetically)
        assert_eq!(files[0].path, "ccc.txt"); // A
        assert_eq!(files[1].path, "zzz.txt"); // M
                                              // Then untracked (alphabetically)
        assert_eq!(files[2].path, "aaa.txt"); // ?
        assert_eq!(files[3].path, "bbb.txt"); // ?
    }

    // Note: Full integration tests for list_changed_files, get_file_diff, etc.
    // require a real git repository and are better suited for integration tests.
}
