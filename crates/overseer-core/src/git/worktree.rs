//! Git worktree operations.
//!
//! # Overview
//!
//! Git worktrees allow multiple working directories to be attached to
//! a single repository. Overseer uses this to manage "workspaces" -
//! isolated working directories for different branches/tasks.
//!
//! # Key Operations
//!
//! - [`list_workspaces`] - List all worktrees in a repository
//! - [`add_workspace`] - Create a new worktree for a branch
//! - [`archive_workspace`] - Remove a worktree (but keep the branch)
//! - [`pick_workspace_dir`] - Generate a unique directory name for a new workspace
//!
//! # Workspace Directory Structure
//!
//! Workspaces are created under `~/overseer/workspaces/<repo-name>/`:
//!
//! ```text
//! ~/overseer/workspaces/
//! └── my-project/
//!     ├── narwhal/      # Workspace named after an animal
//!     ├── capybara/     # Another workspace
//!     └── pangolin-v2/  # With version suffix if name taken
//! ```
//!
//! In development mode (`debug_assertions`), uses `workspaces-dev/` instead.

use super::{run_git, GitError, ANIMALS};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================================
// TYPES
// ============================================================================

/// Information about a git worktree.
///
/// Represents a single working directory attached to a repository.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    /// Absolute path to the worktree directory
    pub path: String,

    /// Branch name checked out in this worktree
    ///
    /// Will be "HEAD (detached)" if in detached HEAD state.
    pub branch: String,
}

// ============================================================================
// LISTING WORKSPACES
// ============================================================================

/// List all worktrees in a repository.
///
/// Parses the output of `git worktree list --porcelain` to get
/// information about all attached worktrees.
///
/// # Arguments
///
/// * `repo_path` - Path to any directory in the repository
///
/// # Returns
///
/// Vector of `WorkspaceInfo` for each worktree, including the main worktree.
///
/// # Example
///
/// ```ignore
/// let workspaces = list_workspaces("/path/to/repo").await?;
/// for ws in workspaces {
///     println!("{}: {}", ws.branch, ws.path);
/// }
/// ```
pub async fn list_workspaces(repo_path: &Path) -> Result<Vec<WorkspaceInfo>, GitError> {
    // Run git worktree list in porcelain format for reliable parsing
    let output = run_git(&["worktree", "list", "--porcelain"], repo_path).await?;

    if !output.success {
        return Err(GitError::GitFailed {
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut workspaces = Vec::new();
    let mut current_path = String::new();
    let mut current_branch = String::new();

    // Parse porcelain output format:
    // worktree /path/to/worktree
    // HEAD <sha>
    // branch refs/heads/branch-name
    // <blank line>
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = path.to_string();
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = branch.to_string();
        } else if line.is_empty() && !current_path.is_empty() {
            // End of worktree entry
            workspaces.push(WorkspaceInfo {
                path: current_path.clone(),
                branch: if current_branch.is_empty() {
                    "HEAD (detached)".to_string()
                } else {
                    current_branch.clone()
                },
            });
            current_path.clear();
            current_branch.clear();
        }
    }

    // Handle last entry if no trailing newline
    if !current_path.is_empty() {
        workspaces.push(WorkspaceInfo {
            path: current_path,
            branch: if current_branch.is_empty() {
                "HEAD (detached)".to_string()
            } else {
                current_branch
            },
        });
    }

    Ok(workspaces)
}

// ============================================================================
// ADDING WORKSPACES
// ============================================================================

/// Pick a unique directory path for a new workspace.
///
/// Generates workspace paths using animal names under the Overseer
/// workspaces directory structure. Uses a time-based shuffle to pick
/// names randomly but deterministically.
///
/// # Arguments
///
/// * `repo_path` - Path to the repository (used to derive the repo name)
///
/// # Returns
///
/// A `PathBuf` to a non-existent directory suitable for a new workspace.
///
/// # Directory Structure
///
/// Returns paths like:
/// - `~/overseer/workspaces/my-repo/narwhal/`
/// - `~/overseer/workspaces/my-repo/capybara/`
/// - `~/overseer/workspaces/my-repo/narwhal-v2/` (if `narwhal` exists)
///
/// # Errors
///
/// Returns an error if:
/// - HOME environment variable is not set
/// - Cannot create the workspaces directory
/// - All possible names are exhausted (unlikely)
pub fn pick_workspace_dir(repo_path: &Path) -> Result<PathBuf, GitError> {
    // Extract repo name from path
    let repo_name = repo_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Get home directory
    let home =
        std::env::var("HOME").map_err(|_| GitError::PathError("HOME not set".to_string()))?;

    // Use different directory in development vs production
    let workspaces_dir = if cfg!(debug_assertions) {
        "workspaces-dev"
    } else {
        "workspaces"
    };

    // Build base path: ~/overseer/workspaces[-dev]/repo-name/
    let base = PathBuf::from(home)
        .join("overseer")
        .join(workspaces_dir)
        .join(&repo_name);

    // Ensure base directory exists
    std::fs::create_dir_all(&base)
        .map_err(|e| GitError::PathError(format!("Failed to create workspaces dir: {e}")))?;

    // Generate a seed from current time for shuffling
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as usize;

    // Shuffle animal names using xorshift
    let mut candidates: Vec<&str> = ANIMALS.to_vec();
    let len = candidates.len();
    let mut s = seed;
    for i in (1..len).rev() {
        // Xorshift for pseudo-random shuffling
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let j = s % (i + 1);
        candidates.swap(i, j);
    }

    // Try each animal name
    for name in &candidates {
        let dir = base.join(name);
        if !dir.exists() {
            return Ok(dir);
        }
    }

    // All base names taken - append version suffix
    for name in &candidates {
        for v in 1u32.. {
            let dir = base.join(format!("{name}-v{v}"));
            if !dir.exists() {
                return Ok(dir);
            }
        }
    }

    Err(GitError::Other(
        "Could not find available workspace name".to_string(),
    ))
}

/// Add a new workspace (worktree) for a branch.
///
/// Creates a new worktree at an auto-generated path. If the branch
/// doesn't exist, it will be created from HEAD.
///
/// # Arguments
///
/// * `repo_path` - Path to the repository
/// * `branch` - Branch name to check out in the new workspace
///
/// # Returns
///
/// The absolute path to the newly created workspace.
///
/// # Behavior
///
/// 1. Picks a unique directory name using [`pick_workspace_dir`]
/// 2. Tries to create worktree with new branch (`git worktree add -b`)
/// 3. If branch exists, creates worktree for existing branch
/// 4. Returns the canonicalized absolute path
///
/// # Errors
///
/// Returns an error if:
/// - Cannot pick a workspace directory
/// - Git worktree creation fails
/// - Cannot resolve the absolute path
pub async fn add_workspace(repo_path: &Path, branch: &str) -> Result<PathBuf, GitError> {
    let workspace_path = pick_workspace_dir(repo_path)?;
    let workspace_str = workspace_path.to_string_lossy();

    // Try to create with new branch first
    let output = run_git(
        &["worktree", "add", &workspace_str, "-b", branch],
        repo_path,
    )
    .await?;

    if !output.success {
        // Branch might already exist - try without -b
        let output2 = run_git(&["worktree", "add", &workspace_str, branch], repo_path).await?;

        if !output2.success {
            return Err(GitError::GitFailed {
                stderr: String::from_utf8_lossy(&output2.stderr).to_string(),
                stdout: String::from_utf8_lossy(&output2.stdout).to_string(),
            });
        }
    }

    // Resolve to absolute path
    std::fs::canonicalize(&workspace_path)
        .map_err(|e| GitError::PathError(format!("Failed to resolve path: {e}")))
}

// ============================================================================
// ARCHIVING WORKSPACES
// ============================================================================

/// Remove a workspace (worktree) from the repository.
///
/// Detaches the worktree from the repository and removes the directory.
/// The branch itself is preserved and can be used in a new workspace.
///
/// # Arguments
///
/// * `repo_path` - Path to the repository
/// * `workspace_path` - Path to the workspace to remove
///
/// # Behavior
///
/// 1. Tries `git worktree remove <path>`
/// 2. If that fails (e.g., uncommitted changes), tries `--force`
///
/// # Errors
///
/// Returns an error if both normal and force removal fail.
pub async fn archive_workspace(repo_path: &Path, workspace_path: &Path) -> Result<(), GitError> {
    let workspace_str = workspace_path.to_string_lossy();

    // Try normal removal first
    let output = run_git(&["worktree", "remove", &workspace_str], repo_path).await?;

    if output.success {
        return Ok(());
    }

    // Force removal if normal fails (e.g., uncommitted changes)
    let output2 = run_git(
        &["worktree", "remove", "--force", &workspace_str],
        repo_path,
    )
    .await?;

    if output2.success {
        Ok(())
    } else {
        Err(GitError::GitFailed {
            stderr: String::from_utf8_lossy(&output2.stderr).to_string(),
            stdout: String::from_utf8_lossy(&output2.stdout).to_string(),
        })
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn workspace_info_serializes() {
        let info = WorkspaceInfo {
            path: "/path/to/workspace".to_string(),
            branch: "feature-branch".to_string(),
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("feature-branch"));
        assert!(json.contains("/path/to/workspace"));
    }

    #[test]
    fn pick_workspace_dir_returns_path() {
        // This test requires HOME to be set, which it should be in normal environments
        if std::env::var("HOME").is_ok() {
            let dir = tempdir().unwrap();
            let result = pick_workspace_dir(dir.path());

            assert!(result.is_ok());
            let path = result.unwrap();

            // Should contain an animal name
            let path_str = path.to_string_lossy();
            let contains_animal = ANIMALS.iter().any(|a| path_str.contains(a));
            assert!(contains_animal);
        }
    }

    #[test]
    fn pick_workspace_dir_uses_correct_workspaces_dir() {
        if std::env::var("HOME").is_ok() {
            let dir = tempdir().unwrap();
            let result = pick_workspace_dir(dir.path()).unwrap();
            let path_str = result.to_string_lossy();

            // In test mode (debug_assertions = true), should use workspaces-dev
            if cfg!(debug_assertions) {
                assert!(path_str.contains("workspaces-dev"));
            } else {
                assert!(path_str.contains("workspaces"));
            }
        }
    }

    // Note: Tests for list_workspaces, add_workspace, and archive_workspace
    // would require a real git repository, so they're better suited for
    // integration tests. Unit tests here focus on pure functions.

    #[test]
    fn parse_porcelain_output() {
        // Test parsing of git worktree list --porcelain output
        let porcelain = "worktree /path/to/main\nHEAD abc123\nbranch refs/heads/main\n\nworktree /path/to/feature\nHEAD def456\nbranch refs/heads/feature\n\n";

        let lines: Vec<&str> = porcelain.lines().collect();
        let mut workspaces = Vec::new();
        let mut current_path = String::new();
        let mut current_branch = String::new();

        for line in lines {
            if let Some(path) = line.strip_prefix("worktree ") {
                current_path = path.to_string();
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                current_branch = branch.to_string();
            } else if line.is_empty() && !current_path.is_empty() {
                workspaces.push(WorkspaceInfo {
                    path: current_path.clone(),
                    branch: current_branch.clone(),
                });
                current_path.clear();
                current_branch.clear();
            }
        }

        assert_eq!(workspaces.len(), 2);
        assert_eq!(workspaces[0].branch, "main");
        assert_eq!(workspaces[1].branch, "feature");
    }
}
