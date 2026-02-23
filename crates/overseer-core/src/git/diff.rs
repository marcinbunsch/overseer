//! Git diff operations.
//!
//! # Overview
//!
//! This module provides functions to query changed files and get diffs
//! in git workspaces. It distinguishes between:
//!
//! - **Branch changes**: Committed changes compared to the default branch
//! - **Uncommitted changes**: Staged and unstaged changes vs HEAD
//! - **Commit changes**: Changes introduced by a specific commit
//!
//! # Key Operations
//!
//! - [`list_changed_files`] - Get all changed files in a workspace
//! - [`get_file_diff`] - Get the diff for a specific file (branch changes)
//! - [`get_uncommitted_diff`] - Get the diff for uncommitted changes
//! - [`list_commits_on_branch`] - Get all commits on this branch vs default
//! - [`list_commit_files`] - Get files changed in a specific commit
//! - [`get_commit_diff`] - Get the diff for a file in a specific commit
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

/// A commit on the branch.
///
/// Represents a single commit with its short SHA and message.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    /// Short commit SHA (7 characters)
    pub short_id: String,

    /// First line of the commit message
    pub message: String,
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
pub async fn list_changed_files(workspace_path: &Path) -> Result<ChangedFilesResult, GitError> {
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut uncommitted: Vec<ChangedFile> = Vec::new();

    // Get current branch
    let current_branch = get_current_branch(workspace_path).await?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    // === Uncommitted changes (staged + unstaged against HEAD) ===
    let uncommitted_output = run_git(&["diff", "--name-status", "HEAD"], workspace_path).await?;
    uncommitted.extend(parse_diff_name_status(&String::from_utf8_lossy(
        &uncommitted_output.stdout,
    )));

    // Include untracked files in uncommitted
    let untracked = run_git(
        &["ls-files", "--others", "--exclude-standard"],
        workspace_path,
    )
    .await?;

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
        let default_branch = get_default_branch(workspace_path).await;

        // Find the merge base (common ancestor)
        let merge_base = run_git(&["merge-base", "HEAD", &default_branch], workspace_path).await?;

        if merge_base.success {
            let base_ref = String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string();

            // Diff from merge-base to HEAD (committed changes only)
            let output = run_git(
                &["diff", "--name-status", &base_ref, "HEAD"],
                workspace_path,
            )
            .await?;

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
pub async fn get_file_diff(
    workspace_path: &Path,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    // Untracked and newly added files: diff against /dev/null
    if file_status == "?" || file_status == "A" {
        let output = run_git(
            &["diff", "--no-index", "/dev/null", file_path],
            workspace_path,
        )
        .await?;

        // Note: git diff --no-index exits with 1 when files differ (expected)
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // Get current branch to determine base ref
    let current_branch = get_current_branch(workspace_path).await?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    let base_ref = if is_default_branch {
        "HEAD".to_string()
    } else {
        let default_branch = get_default_branch(workspace_path).await;

        // Get merge-base for comparison
        let merge_base = run_git(&["merge-base", "HEAD", &default_branch], workspace_path).await?;

        if merge_base.success {
            String::from_utf8_lossy(&merge_base.stdout)
                .trim()
                .to_string()
        } else {
            "HEAD".to_string()
        }
    };

    let output = run_git(&["diff", &base_ref, "--", file_path], workspace_path).await?;

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
pub async fn get_uncommitted_diff(
    workspace_path: &Path,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    // Untracked files: diff against /dev/null
    if file_status == "?" {
        let output = run_git(
            &["diff", "--no-index", "/dev/null", file_path],
            workspace_path,
        )
        .await?;

        // Note: exit code 1 is expected when files differ
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // Diff against HEAD for uncommitted changes
    let output = run_git(&["diff", "HEAD", "--", file_path], workspace_path).await?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ============================================================================
// COMMIT OPERATIONS
// ============================================================================

/// List all commits on this branch vs the default branch.
///
/// Returns commits from oldest to newest (so they appear in chronological order).
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace directory
///
/// # Returns
///
/// A vector of `Commit` with short SHA and message.
pub async fn list_commits_on_branch(workspace_path: &Path) -> Result<Vec<Commit>, GitError> {
    // Get current branch
    let current_branch = get_current_branch(workspace_path).await?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    if is_default_branch {
        return Ok(Vec::new());
    }

    let default_branch = get_default_branch(workspace_path).await;

    // Find the merge base (common ancestor)
    let merge_base = run_git(&["merge-base", "HEAD", &default_branch], workspace_path).await?;

    if !merge_base.success {
        return Ok(Vec::new());
    }

    let base_ref = String::from_utf8_lossy(&merge_base.stdout)
        .trim()
        .to_string();

    // Get commits from merge-base to HEAD, oldest first
    // Format: short-sha|commit message (first line)
    let range = format!("{}..HEAD", base_ref);
    let output = run_git(
        &["log", "--pretty=format:%h|%s", "--reverse", &range],
        workspace_path,
    )
    .await?;

    if !output.success {
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits = parse_commit_log(&stdout);

    Ok(commits)
}

/// Parse the output of `git log --pretty=format:"%h|%s"`.
///
/// The format is:
/// ```text
/// abc1234|First commit message
/// def5678|Second commit message
/// ```
fn parse_commit_log(stdout: &str) -> Vec<Commit> {
    let mut commits = Vec::new();

    for line in stdout.lines() {
        if let Some((short_id, message)) = line.split_once('|') {
            commits.push(Commit {
                short_id: short_id.to_string(),
                message: message.to_string(),
            });
        }
    }

    commits
}

/// List files changed in a specific commit.
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace
/// * `commit_sha` - Short or full SHA of the commit
///
/// # Returns
///
/// A vector of `ChangedFile` with status and path.
pub async fn list_commit_files(
    workspace_path: &Path,
    commit_sha: &str,
) -> Result<Vec<ChangedFile>, GitError> {
    // Use diff-tree to get files changed in this commit
    let output = run_git(
        &["diff-tree", "--no-commit-id", "--name-status", "-r", commit_sha],
        workspace_path,
    )
    .await?;

    if !output.success {
        return Err(GitError::GitFailed {
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files = parse_diff_name_status(&stdout);

    Ok(files)
}

/// Get the diff for a specific file in a specific commit.
///
/// Shows the changes introduced by that commit for the given file.
///
/// # Arguments
///
/// * `workspace_path` - Path to the workspace
/// * `commit_sha` - Short or full SHA of the commit
/// * `file_path` - Path to the file (relative to workspace root)
/// * `file_status` - Status code from [`ChangedFile::status`]
///
/// # Returns
///
/// The diff output as a string in unified diff format.
pub async fn get_commit_diff(
    workspace_path: &Path,
    commit_sha: &str,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    // For added files, show full content as diff
    if file_status == "A" {
        // Show the file as added (diff from empty)
        let output = run_git(
            &["show", "--format=", commit_sha, "--", file_path],
            workspace_path,
        )
        .await?;

        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // For deleted files, show what was removed
    if file_status == "D" {
        // Show the diff for the deleted file
        let parent = format!("{}^", commit_sha);
        let output = run_git(
            &["diff", &parent, commit_sha, "--", file_path],
            workspace_path,
        )
        .await?;

        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    // For modified/other files, show the diff introduced by this commit
    let output = run_git(
        &["show", "--format=", commit_sha, "--", file_path],
        workspace_path,
    )
    .await?;

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

    // ------------------------------------------------------------------------
    // Commit Parsing Tests
    // ------------------------------------------------------------------------

    #[test]
    fn parse_commit_log_basic() {
        let output = "abc1234|First commit\ndef5678|Second commit";
        let commits = parse_commit_log(output);

        assert_eq!(commits.len(), 2);

        assert_eq!(commits[0].short_id, "abc1234");
        assert_eq!(commits[0].message, "First commit");

        assert_eq!(commits[1].short_id, "def5678");
        assert_eq!(commits[1].message, "Second commit");
    }

    #[test]
    fn parse_commit_log_with_pipe_in_message() {
        // Commit message containing a pipe should still work
        let output = "abc1234|Fix bug | add test";
        let commits = parse_commit_log(output);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].short_id, "abc1234");
        assert_eq!(commits[0].message, "Fix bug | add test");
    }

    #[test]
    fn parse_commit_log_empty() {
        let output = "";
        let commits = parse_commit_log(output);

        assert!(commits.is_empty());
    }

    #[test]
    fn commit_serializes_camel_case() {
        let commit = Commit {
            short_id: "abc1234".to_string(),
            message: "Test commit".to_string(),
        };

        let json = serde_json::to_string(&commit).unwrap();
        // Should use camelCase for TypeScript compatibility
        assert!(json.contains("shortId"));
        assert!(json.contains("\"abc1234\""));
        assert!(json.contains("Test commit"));
    }

    // Note: Full integration tests for list_changed_files, get_file_diff, etc.
    // require a real git repository and are better suited for integration tests.
}
