//! Git operations for workspace and repository management.
//!
//! # Overview
//!
//! This module provides async Rust implementations of git operations
//! used by Overseer. It wraps the `git` CLI for maximum compatibility
//! with user configurations (SSH keys, credentials, hooks, etc.).
//!
//! # Why CLI Instead of libgit2
//!
//! We use the `git` command-line tool rather than libgit2 because:
//!
//! 1. **Authentication**: Git CLI uses user's configured SSH agent, credential
//!    helpers, and GPG keys without additional setup
//! 2. **Compatibility**: Works with all git configurations and hooks
//! 3. **Maintenance**: No need to track libgit2 API changes or bugs
//! 4. **Simplicity**: The operations we need are straightforward CLI calls
//!
//! # Modules
//!
//! - [`worktree`] - Git worktree management (list, add, remove)
//! - [`diff`] - Diff operations (changed files, file diffs)
//! - [`merge`] - Merge checking and execution
//! - [`branch`] - Branch operations (rename, delete)
//!
//! # Error Handling
//!
//! All operations return `Result<T, GitError>`. The `GitError` type
//! captures both command execution failures and git-specific errors.
//!
//! # Example
//!
//! ```ignore
//! use overseer_core::git::{
//!     worktree::{list_workspaces, add_workspace},
//!     diff::list_changed_files,
//!     merge::check_merge,
//! };
//!
//! // List all worktrees
//! let workspaces = list_workspaces("/path/to/repo").await?;
//!
//! // Get changed files in a workspace
//! let changes = list_changed_files("/path/to/workspace").await?;
//!
//! // Check if merge would succeed
//! let result = check_merge("/path/to/workspace").await?;
//! ```

pub mod branch;
pub mod diff;
pub mod merge;
pub mod worktree;

use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

// Re-export commonly used items
pub use branch::{delete_branch, rename_branch};
pub use diff::{
    get_file_diff, get_uncommitted_diff, list_changed_files, parse_diff_name_status, ChangedFile,
    ChangedFilesResult,
};
pub use merge::{check_merge, merge_into_main, MergeResult};
pub use worktree::{
    add_workspace, archive_workspace, list_workspaces, pick_workspace_dir, WorkspaceInfo,
};

// ============================================================================
// ERROR TYPE
// ============================================================================

/// Error type for git operations.
///
/// Captures both command execution failures and git-specific errors.
#[derive(Debug)]
pub enum GitError {
    /// Command failed to execute (e.g., git not found)
    CommandFailed(std::io::Error),

    /// Git command returned non-zero exit code
    GitFailed {
        /// The stderr output from git
        stderr: String,
        /// The stdout output (sometimes contains useful info)
        stdout: String,
    },

    /// Path-related error
    PathError(String),

    /// Other error with message
    Other(String),
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::CommandFailed(e) => write!(f, "Failed to run git: {e}"),
            GitError::GitFailed { stderr, .. } => write!(f, "Git error: {stderr}"),
            GitError::PathError(msg) => write!(f, "Path error: {msg}"),
            GitError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for GitError {}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        GitError::CommandFailed(e)
    }
}

// ============================================================================
// OUTPUT TYPE
// ============================================================================

/// Output from a git command.
///
/// Similar to `std::process::Output` but owned strings for convenience.
#[derive(Debug)]
pub struct GitOutput {
    /// Whether the command succeeded (exit code 0)
    pub success: bool,
    /// The stdout output
    pub stdout: Vec<u8>,
    /// The stderr output
    pub stderr: Vec<u8>,
}

impl GitOutput {
    /// Get stdout as a string (lossy UTF-8 conversion)
    pub fn stdout_str(&self) -> String {
        String::from_utf8_lossy(&self.stdout).to_string()
    }

    /// Get stderr as a string (lossy UTF-8 conversion)
    pub fn stderr_str(&self) -> String {
        String::from_utf8_lossy(&self.stderr).to_string()
    }
}

// ============================================================================
// COMMON UTILITIES
// ============================================================================

/// Run a git command asynchronously and return the output.
///
/// This is the core helper used by all git operations. It:
/// 1. Runs the command in the specified directory
/// 2. Captures stdout and stderr
/// 3. Returns the output for further processing
///
/// # Arguments
///
/// * `args` - Git command arguments (e.g., `["status", "--porcelain"]`)
/// * `cwd` - Working directory to run the command in
///
/// # Returns
///
/// The `GitOutput` from the command, or `GitError` if the command failed to run.
pub async fn run_git(args: &[&str], cwd: &Path) -> Result<GitOutput, GitError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(GitError::CommandFailed)?;

    Ok(GitOutput {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

/// Run a git command asynchronously and check for success.
///
/// Convenience wrapper that returns the stdout as a string if successful,
/// or an error with stderr if the command failed.
///
/// # Arguments
///
/// * `args` - Git command arguments
/// * `cwd` - Working directory
///
/// # Returns
///
/// The stdout as a trimmed string, or `GitError` on failure.
pub async fn run_git_success(args: &[&str], cwd: &Path) -> Result<String, GitError> {
    let output = run_git(args, cwd).await?;

    if output.success {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(GitError::GitFailed {
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        })
    }
}

/// Check if a git ref exists (async).
///
/// Uses `git rev-parse --verify` to check if a ref is valid.
///
/// # Arguments
///
/// * `ref_name` - The ref to check (branch name, tag, commit, etc.)
/// * `cwd` - Working directory
///
/// # Returns
///
/// `true` if the ref exists, `false` otherwise.
pub async fn ref_exists(ref_name: &str, cwd: &Path) -> bool {
    let output = Command::new("git")
        .args(["rev-parse", "--verify", ref_name])
        .current_dir(cwd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;

    output.map(|s| s.success()).unwrap_or(false)
}

/// Get the current branch name (async).
///
/// # Arguments
///
/// * `cwd` - Working directory (must be inside a git repo)
///
/// # Returns
///
/// The current branch name, or "HEAD" if in detached HEAD state.
pub async fn get_current_branch(cwd: &Path) -> Result<String, GitError> {
    run_git_success(&["rev-parse", "--abbrev-ref", "HEAD"], cwd).await
}

/// Detect the default branch (main, master, etc.) (async).
///
/// Checks for local branches first, then remote tracking branches.
/// Falls back to "main" if none found.
///
/// # Arguments
///
/// * `cwd` - Working directory (must be inside a git repo)
///
/// # Returns
///
/// The default branch name (e.g., "main", "master", "origin/main").
pub async fn get_default_branch(cwd: &Path) -> String {
    // Check candidates in order of preference
    for candidate in &["main", "master", "origin/main", "origin/master"] {
        if ref_exists(candidate, cwd).await {
            return (*candidate).to_string();
        }
    }

    // Fallback
    "main".to_string()
}

/// Check if the current branch is the default branch (async).
///
/// Returns true if on main, master, or in detached HEAD state.
pub async fn is_on_default_branch(cwd: &Path) -> Result<bool, GitError> {
    let branch = get_current_branch(cwd).await?;
    Ok(branch == "main" || branch == "master" || branch == "HEAD")
}

/// Check if a path is inside a git repository.
///
/// Checks for the presence of `.git` (either a directory for regular repos,
/// or a file for worktrees that points to the actual git directory).
/// This is synchronous since it's just a filesystem check.
pub fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

// ============================================================================
// ANIMAL NAMES FOR WORKSPACES
// ============================================================================

/// Animal names used for generating workspace directory names.
///
/// These provide memorable, unique names for worktree directories.
pub const ANIMALS: &[&str] = &[
    "alpaca",
    "badger",
    "capybara",
    "dingo",
    "elephant",
    "falcon",
    "gazelle",
    "heron",
    "ibex",
    "jackal",
    "koala",
    "lemur",
    "meerkat",
    "narwhal",
    "ocelot",
    "pangolin",
    "quokka",
    "raccoon",
    "serval",
    "tapir",
    "urial",
    "viper",
    "walrus",
    "xerus",
    "yak",
    "zebu",
    "armadillo",
    "bison",
    "chinchilla",
    "dugong",
    "ermine",
    "ferret",
    "grouse",
    "hedgehog",
    "impala",
    "jaguar",
    "kestrel",
    "lynx",
    "marten",
    "newt",
    "osprey",
    "puma",
    "quail",
    "raven",
    "stoat",
    "toucan",
    "urchin",
    "vulture",
    "wombat",
    "xenops",
    "yapok",
    "zorilla",
];

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn is_git_repo_true_for_git_dir() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();

        assert!(is_git_repo(dir.path()));
    }

    #[test]
    fn is_git_repo_false_for_non_git_dir() {
        let dir = tempdir().unwrap();

        assert!(!is_git_repo(dir.path()));
    }

    #[test]
    fn animals_list_is_not_empty() {
        assert!(!ANIMALS.is_empty());
        assert!(ANIMALS.len() >= 50);
    }

    #[test]
    fn animals_are_lowercase() {
        for animal in ANIMALS {
            assert_eq!(*animal, animal.to_lowercase());
        }
    }

    #[test]
    fn animals_list_has_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for animal in ANIMALS {
            assert!(seen.insert(*animal), "Duplicate animal name: {}", animal);
        }
    }

    #[test]
    fn git_error_display() {
        let err = GitError::CommandFailed(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "git not found",
        ));
        assert!(err.to_string().contains("Failed to run git"));

        let err = GitError::GitFailed {
            stderr: "fatal: not a git repository".to_string(),
            stdout: String::new(),
        };
        assert!(err.to_string().contains("not a git repository"));
    }
}
