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

    /// Submodules with changes
    pub submodules: Vec<SubmoduleResult>,
}

/// A submodule with its changed files.
///
/// Contains the submodule's path, initialization status, and any changed files
/// within the submodule (both committed and uncommitted).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleResult {
    /// Name of the submodule (from .gitmodules)
    pub name: String,

    /// Path to the submodule (relative to workspace root)
    pub path: String,

    /// Whether the submodule is initialized (has been cloned)
    pub is_initialized: bool,

    /// Files changed inside the submodule (committed changes)
    pub files: Vec<ChangedFile>,

    /// Uncommitted changes inside the submodule
    pub uncommitted: Vec<ChangedFile>,

    /// Nested submodules (for recursive support)
    pub submodules: Vec<SubmoduleResult>,
}

impl SubmoduleResult {
    /// Returns true if this submodule or any nested submodule has changes.
    pub fn has_changes(&self) -> bool {
        !self.files.is_empty()
            || !self.uncommitted.is_empty()
            || self.submodules.iter().any(|s| s.has_changes())
    }

    /// Returns the total count of changed files, including nested submodules.
    pub fn total_file_count(&self) -> usize {
        self.files.len()
            + self.uncommitted.len()
            + self.submodules.iter().map(|s| s.total_file_count()).sum::<usize>()
    }
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

/// Parse the output of `git config --file .gitmodules --get-regexp path`.
///
/// The format is:
/// ```text
/// submodule.name1.path path/to/submodule1
/// submodule.name2.path path/to/submodule2
/// ```
///
/// # Returns
///
/// Vector of (name, path) tuples.
pub fn parse_submodules(stdout: &str) -> Vec<(String, String)> {
    let mut submodules = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Format: "submodule.<name>.path <path>"
        // Split by whitespace to separate key from value
        let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
        if parts.len() != 2 {
            continue;
        }

        let key = parts[0]; // "submodule.<name>.path"
        let path = parts[1].trim();

        // Extract name from "submodule.<name>.path"
        if let Some(name) = key
            .strip_prefix("submodule.")
            .and_then(|s| s.strip_suffix(".path"))
        {
            submodules.push((name.to_string(), path.to_string()));
        }
    }

    submodules
}

// ============================================================================
// SUBMODULE OPERATIONS
// ============================================================================

/// List submodules in a workspace.
///
/// Returns a list of (name, path) tuples from .gitmodules.
/// Returns an empty list if no submodules exist or .gitmodules is not present.
async fn list_submodules(workspace_path: &Path) -> Vec<(String, String)> {
    // Check if .gitmodules exists
    let gitmodules_path = workspace_path.join(".gitmodules");
    if !gitmodules_path.exists() {
        return Vec::new();
    }

    let output = run_git(
        &["config", "--file", ".gitmodules", "--get-regexp", "path"],
        workspace_path,
    )
    .await;

    match output {
        Ok(result) if result.success => {
            parse_submodules(&String::from_utf8_lossy(&result.stdout))
        }
        _ => Vec::new(),
    }
}

/// Check if a submodule is initialized (cloned).
///
/// A submodule is initialized if its directory exists and contains a .git file/folder.
fn is_submodule_initialized(workspace_path: &Path, submodule_path: &str) -> bool {
    let full_path = workspace_path.join(submodule_path);
    let git_path = full_path.join(".git");

    // .git can be a file (worktree) or directory (regular clone)
    full_path.exists() && git_path.exists()
}

/// Get changed files inside a specific submodule.
///
/// Recursively calls list_changed_files on the submodule directory.
/// Uses Box::pin to handle async recursion (Rust requires this for recursive async fns).
fn list_submodule_changes(
    workspace_path: std::path::PathBuf,
    name: String,
    submodule_path: String,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = SubmoduleResult> + Send>> {
    Box::pin(async move {
        let is_initialized = is_submodule_initialized(&workspace_path, &submodule_path);

        if !is_initialized {
            return SubmoduleResult {
                name,
                path: submodule_path,
                is_initialized: false,
                files: Vec::new(),
                uncommitted: Vec::new(),
                submodules: Vec::new(),
            };
        }

        let full_submodule_path = workspace_path.join(&submodule_path);

        // Get changes inside the submodule (recursive call handles nested submodules)
        match list_changed_files_internal(&full_submodule_path).await {
            Ok(result) => SubmoduleResult {
                name,
                path: submodule_path,
                is_initialized: true,
                files: result.files,
                uncommitted: result.uncommitted,
                submodules: result.submodules,
            },
            Err(_) => SubmoduleResult {
                name,
                path: submodule_path,
                is_initialized: true,
                files: Vec::new(),
                uncommitted: Vec::new(),
                submodules: Vec::new(),
            },
        }
    })
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
/// - `submodules`: Changes inside submodules
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
    list_changed_files_internal(workspace_path).await
}

/// Internal implementation of list_changed_files.
///
/// This is separated to allow recursive calls for submodules.
async fn list_changed_files_internal(workspace_path: &Path) -> Result<ChangedFilesResult, GitError> {
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut uncommitted: Vec<ChangedFile> = Vec::new();

    // Get current branch
    let current_branch = get_current_branch(workspace_path).await?;

    let is_default_branch =
        current_branch == "main" || current_branch == "master" || current_branch == "HEAD";

    // === Get list of submodules ===
    let submodule_list = list_submodules(workspace_path).await;
    let submodule_paths: std::collections::HashSet<&str> =
        submodule_list.iter().map(|(_, p)| p.as_str()).collect();

    // === Uncommitted changes (staged + unstaged against HEAD) ===
    let uncommitted_output = run_git(&["diff", "--name-status", "HEAD"], workspace_path).await?;
    let all_uncommitted = parse_diff_name_status(&String::from_utf8_lossy(
        &uncommitted_output.stdout,
    ));

    // Filter out submodule entries
    uncommitted.extend(
        all_uncommitted
            .into_iter()
            .filter(|f| !submodule_paths.contains(f.path.as_str())),
    );

    // Include untracked files in uncommitted
    let untracked = run_git(
        &["ls-files", "--others", "--exclude-standard"],
        workspace_path,
    )
    .await?;

    let untracked_stdout = String::from_utf8_lossy(&untracked.stdout);
    for line in untracked_stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !submodule_paths.contains(trimmed) {
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

            let all_files = parse_diff_name_status(&String::from_utf8_lossy(&output.stdout));

            // Filter out submodule entries
            files.extend(
                all_files
                    .into_iter()
                    .filter(|f| !submodule_paths.contains(f.path.as_str())),
            );

            // Sort branch changes alphabetically
            files.sort_by(|a, b| a.path.cmp(&b.path));
        }
    }

    // === Submodule changes ===
    let mut submodules = Vec::new();
    for (name, path) in submodule_list {
        let sub_result: SubmoduleResult =
            list_submodule_changes(workspace_path.to_path_buf(), name, path).await;

        // Only include submodules that have changes
        if sub_result.has_changes() {
            submodules.push(sub_result);
        }
    }

    Ok(ChangedFilesResult {
        files,
        uncommitted,
        is_default_branch,
        submodules,
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
// SUBMODULE DIFFS
// ============================================================================

/// Get the diff for a file inside a submodule (branch changes).
///
/// This is equivalent to `get_file_diff` but for files within a submodule.
///
/// # Arguments
///
/// * `workspace_path` - Path to the main workspace
/// * `submodule_path` - Path to the submodule (relative to workspace root)
/// * `file_path` - Path to the file (relative to submodule root)
/// * `file_status` - Status code from [`ChangedFile::status`]
///
/// # Returns
///
/// The diff output as a string in unified diff format.
pub async fn get_submodule_file_diff(
    workspace_path: &Path,
    submodule_path: &str,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    let full_submodule_path = workspace_path.join(submodule_path);
    get_file_diff(&full_submodule_path, file_path, file_status).await
}

/// Get the diff for uncommitted changes to a file inside a submodule.
///
/// This is equivalent to `get_uncommitted_diff` but for files within a submodule.
///
/// # Arguments
///
/// * `workspace_path` - Path to the main workspace
/// * `submodule_path` - Path to the submodule (relative to workspace root)
/// * `file_path` - Path to the file (relative to submodule root)
/// * `file_status` - Status code from [`ChangedFile::status`]
///
/// # Returns
///
/// The diff output as a string in unified diff format.
pub async fn get_submodule_uncommitted_diff(
    workspace_path: &Path,
    submodule_path: &str,
    file_path: &str,
    file_status: &str,
) -> Result<String, GitError> {
    let full_submodule_path = workspace_path.join(submodule_path);
    get_uncommitted_diff(&full_submodule_path, file_path, file_status).await
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
            submodules: vec![],
        };

        let json = serde_json::to_string(&result).unwrap();
        // Should use camelCase for TypeScript compatibility
        assert!(json.contains("isDefaultBranch"));
        assert!(json.contains("submodules"));
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

    // ------------------------------------------------------------------------
    // Submodule Tests
    // ------------------------------------------------------------------------

    #[test]
    fn parse_submodules_basic() {
        let output = "submodule.lib-core.path lib/core\nsubmodule.lib-utils.path lib/utils";
        let submodules = parse_submodules(output);

        assert_eq!(submodules.len(), 2);

        assert_eq!(submodules[0].0, "lib-core");
        assert_eq!(submodules[0].1, "lib/core");

        assert_eq!(submodules[1].0, "lib-utils");
        assert_eq!(submodules[1].1, "lib/utils");
    }

    #[test]
    fn parse_submodules_with_dots_in_name() {
        // Submodule names can contain dots
        let output = "submodule.my.sub.module.path vendor/my-module";
        let submodules = parse_submodules(output);

        assert_eq!(submodules.len(), 1);
        assert_eq!(submodules[0].0, "my.sub.module");
        assert_eq!(submodules[0].1, "vendor/my-module");
    }

    #[test]
    fn parse_submodules_empty() {
        let output = "";
        let submodules = parse_submodules(output);

        assert!(submodules.is_empty());
    }

    #[test]
    fn parse_submodules_with_whitespace() {
        let output = "  submodule.test.path   path/to/test  \n";
        let submodules = parse_submodules(output);

        assert_eq!(submodules.len(), 1);
        assert_eq!(submodules[0].0, "test");
        assert_eq!(submodules[0].1, "path/to/test");
    }

    #[test]
    fn submodule_result_serializes_camel_case() {
        let result = SubmoduleResult {
            name: "test-module".to_string(),
            path: "lib/test".to_string(),
            is_initialized: true,
            files: vec![],
            uncommitted: vec![],
            submodules: vec![],
        };

        let json = serde_json::to_string(&result).unwrap();
        // Should use camelCase for TypeScript compatibility
        assert!(json.contains("isInitialized"));
        assert!(json.contains("\"name\":\"test-module\""));
        assert!(json.contains("\"path\":\"lib/test\""));
    }

    #[test]
    fn submodule_has_changes_empty() {
        let result = SubmoduleResult {
            name: "test".to_string(),
            path: "lib/test".to_string(),
            is_initialized: true,
            files: vec![],
            uncommitted: vec![],
            submodules: vec![],
        };

        assert!(!result.has_changes());
    }

    #[test]
    fn submodule_has_changes_with_files() {
        let result = SubmoduleResult {
            name: "test".to_string(),
            path: "lib/test".to_string(),
            is_initialized: true,
            files: vec![ChangedFile {
                status: "M".to_string(),
                path: "src/lib.rs".to_string(),
            }],
            uncommitted: vec![],
            submodules: vec![],
        };

        assert!(result.has_changes());
    }

    #[test]
    fn submodule_has_changes_with_uncommitted() {
        let result = SubmoduleResult {
            name: "test".to_string(),
            path: "lib/test".to_string(),
            is_initialized: true,
            files: vec![],
            uncommitted: vec![ChangedFile {
                status: "A".to_string(),
                path: "new.rs".to_string(),
            }],
            submodules: vec![],
        };

        assert!(result.has_changes());
    }

    #[test]
    fn submodule_has_changes_nested() {
        let nested = SubmoduleResult {
            name: "nested".to_string(),
            path: "lib/nested".to_string(),
            is_initialized: true,
            files: vec![ChangedFile {
                status: "M".to_string(),
                path: "src/lib.rs".to_string(),
            }],
            uncommitted: vec![],
            submodules: vec![],
        };

        let result = SubmoduleResult {
            name: "parent".to_string(),
            path: "lib/parent".to_string(),
            is_initialized: true,
            files: vec![],
            uncommitted: vec![],
            submodules: vec![nested],
        };

        assert!(result.has_changes());
    }

    #[test]
    fn submodule_total_file_count() {
        let nested = SubmoduleResult {
            name: "nested".to_string(),
            path: "lib/nested".to_string(),
            is_initialized: true,
            files: vec![ChangedFile {
                status: "M".to_string(),
                path: "src/lib.rs".to_string(),
            }],
            uncommitted: vec![ChangedFile {
                status: "A".to_string(),
                path: "new.rs".to_string(),
            }],
            submodules: vec![],
        };

        let result = SubmoduleResult {
            name: "parent".to_string(),
            path: "lib/parent".to_string(),
            is_initialized: true,
            files: vec![
                ChangedFile {
                    status: "M".to_string(),
                    path: "a.rs".to_string(),
                },
                ChangedFile {
                    status: "M".to_string(),
                    path: "b.rs".to_string(),
                },
            ],
            uncommitted: vec![],
            submodules: vec![nested],
        };

        // 2 (parent files) + 2 (nested files + uncommitted)
        assert_eq!(result.total_file_count(), 4);
    }

    // Note: Full integration tests for list_changed_files, get_file_diff, etc.
    // require a real git repository and are better suited for integration tests.
}
