//! Approvals persistence.
//!
//! # Overview
//!
//! Approvals track which tools and command prefixes the user has marked as
//! "always approve". This avoids repetitive approval prompts for trusted tools.
//!
//! # File Format
//!
//! Stored as `approvals.json` in the workspace data directory:
//!
//! ```json
//! {
//!   "toolNames": ["Read", "Glob", "Grep"],
//!   "commandPrefixes": ["git ", "npm ", "cargo "]
//! }
//! ```
//!
//! # Scope
//!
//! Approvals are **workspace-scoped**. Each workspace has its own approvals
//! file, so trusted tools in one project don't automatically carry over
//! to another project (security boundary).
//!
//! # Usage
//!
//! ```ignore
//! use overseer_core::persistence::approvals::*;
//!
//! // Load approvals (returns empty if file doesn't exist)
//! let approvals = load_approvals(workspace_dir)?;
//!
//! // Add a trusted tool
//! let mut approvals = approvals;
//! add_tool_name(&mut approvals, "Read");
//!
//! // Add a trusted command prefix
//! add_command_prefix(&mut approvals, "git ");
//!
//! // Save back
//! save_approvals(workspace_dir, &approvals)?;
//! ```

use std::fs;
use std::path::Path;

use super::types::ApprovalsData;

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/// Save approvals data to disk.
///
/// # Atomic Write
///
/// Uses write-then-rename pattern to prevent data corruption if the process
/// crashes mid-write. This is the same pattern used throughout the persistence
/// layer for data safety.
///
/// # Arguments
///
/// * `dir` - Directory to save approvals to (usually workspace data dir)
/// * `approvals` - The approvals data to save
///
/// # Errors
///
/// Returns an error if the directory doesn't exist and can't be created,
/// or if file operations fail.
pub fn save_approvals(dir: &Path, approvals: &ApprovalsData) -> Result<(), std::io::Error> {
    // Ensure the directory exists before writing
    fs::create_dir_all(dir)?;

    let file_path = dir.join("approvals.json");
    let temp_path = dir.join("approvals.json.tmp");

    // Serialize to pretty JSON for readability (users may inspect this file)
    let json = serde_json::to_string_pretty(approvals)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    // Write to temp file first
    fs::write(&temp_path, json)?;

    // Atomic rename (on Unix, this is guaranteed atomic)
    fs::rename(&temp_path, &file_path)?;

    Ok(())
}

/// Load approvals data from disk.
///
/// # Returns
///
/// Returns the approvals data, or an empty `ApprovalsData` if the file
/// doesn't exist. This makes it safe to call on fresh workspaces.
///
/// # Arguments
///
/// * `dir` - Directory to load approvals from
///
/// # Errors
///
/// Returns an error only if the file exists but can't be read or parsed.
/// Missing file is not an error (returns empty approvals).
pub fn load_approvals(dir: &Path) -> Result<ApprovalsData, std::io::Error> {
    let file_path = dir.join("approvals.json");

    // If file doesn't exist, return empty approvals (not an error)
    if !file_path.exists() {
        return Ok(ApprovalsData::default());
    }

    let contents = fs::read_to_string(&file_path)?;
    let approvals: ApprovalsData = serde_json::from_str(&contents)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    Ok(approvals)
}

/// Delete approvals file from disk.
///
/// Used when resetting workspace approvals or cleaning up.
///
/// # Arguments
///
/// * `dir` - Directory containing the approvals file
///
/// # Errors
///
/// Returns an error if deletion fails. Does not error if file doesn't exist.
pub fn delete_approvals(dir: &Path) -> Result<(), std::io::Error> {
    let file_path = dir.join("approvals.json");

    // Only try to delete if it exists
    if file_path.exists() {
        fs::remove_file(&file_path)?;
    }

    Ok(())
}

// ============================================================================
// TOOL NAME OPERATIONS
// ============================================================================

/// Add a tool name to the approved list.
///
/// Tool names are things like "Read", "Write", "Bash", "Glob".
/// Once approved, the tool won't prompt for confirmation.
///
/// # Deduplication
///
/// If the tool is already approved, this is a no-op.
///
/// # Arguments
///
/// * `approvals` - Mutable reference to approvals data
/// * `tool_name` - Name of the tool to approve
pub fn add_tool_name(approvals: &mut ApprovalsData, tool_name: &str) {
    // Only add if not already present (avoid duplicates)
    if !approvals.tool_names.iter().any(|t| t == tool_name) {
        approvals.tool_names.push(tool_name.to_string());
    }
}

/// Remove a tool name from the approved list.
///
/// After removal, the tool will prompt for confirmation again.
///
/// # Arguments
///
/// * `approvals` - Mutable reference to approvals data
/// * `tool_name` - Name of the tool to remove
pub fn remove_tool_name(approvals: &mut ApprovalsData, tool_name: &str) {
    approvals.tool_names.retain(|t| t != tool_name);
}

/// Check if a tool name is approved.
///
/// # Arguments
///
/// * `approvals` - Reference to approvals data
/// * `tool_name` - Name of the tool to check
///
/// # Returns
///
/// `true` if the tool is in the approved list.
pub fn has_tool_name(approvals: &ApprovalsData, tool_name: &str) -> bool {
    approvals.tool_names.iter().any(|t| t == tool_name)
}

// ============================================================================
// COMMAND PREFIX OPERATIONS
// ============================================================================

/// Add a command prefix to the approved list.
///
/// Command prefixes are used to approve entire categories of bash commands.
/// For example, approving "git " allows all git commands.
///
/// # Important
///
/// Prefixes should include trailing space to avoid false matches.
/// "git " matches "git status" but not "github-cli".
///
/// # Deduplication
///
/// If the prefix is already approved, this is a no-op.
///
/// # Arguments
///
/// * `approvals` - Mutable reference to approvals data
/// * `prefix` - Command prefix to approve (e.g., "git ", "npm ")
pub fn add_command_prefix(approvals: &mut ApprovalsData, prefix: &str) {
    // Only add if not already present
    if !approvals.command_prefixes.iter().any(|p| p == prefix) {
        approvals.command_prefixes.push(prefix.to_string());
    }
}

/// Remove a command prefix from the approved list.
///
/// # Arguments
///
/// * `approvals` - Mutable reference to approvals data
/// * `prefix` - Command prefix to remove
pub fn remove_command_prefix(approvals: &mut ApprovalsData, prefix: &str) {
    approvals.command_prefixes.retain(|p| p != prefix);
}

/// Check if a command prefix is approved.
///
/// # Arguments
///
/// * `approvals` - Reference to approvals data
/// * `prefix` - Command prefix to check
///
/// # Returns
///
/// `true` if the prefix is in the approved list.
pub fn has_command_prefix(approvals: &ApprovalsData, prefix: &str) -> bool {
    approvals.command_prefixes.iter().any(|p| p == prefix)
}

/// Check if a command matches any approved prefix.
///
/// This is the main function used during approval checking. It tests
/// whether the command starts with any of the approved prefixes.
///
/// # Arguments
///
/// * `approvals` - Reference to approvals data
/// * `command` - Full command string to check
///
/// # Returns
///
/// `true` if the command starts with any approved prefix.
///
/// # Example
///
/// ```ignore
/// approvals.command_prefixes = vec!["git ".to_string(), "npm ".to_string()];
///
/// assert!(command_matches_prefix(&approvals, "git status"));
/// assert!(command_matches_prefix(&approvals, "npm install"));
/// assert!(!command_matches_prefix(&approvals, "rm -rf /"));
/// ```
pub fn command_matches_prefix(approvals: &ApprovalsData, command: &str) -> bool {
    approvals
        .command_prefixes
        .iter()
        .any(|prefix| command.starts_with(prefix))
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ------------------------------------------------------------------------
    // File Operations Tests
    // ------------------------------------------------------------------------

    #[test]
    fn save_and_load_approvals() {
        let dir = tempdir().unwrap();
        let approvals = ApprovalsData {
            tool_names: vec!["Read".to_string(), "Glob".to_string()],
            command_prefixes: vec!["git ".to_string()],
        };

        save_approvals(dir.path(), &approvals).unwrap();
        let loaded = load_approvals(dir.path()).unwrap();

        assert_eq!(loaded.tool_names.len(), 2);
        assert!(loaded.tool_names.contains(&"Read".to_string()));
        assert!(loaded.tool_names.contains(&"Glob".to_string()));
        assert_eq!(loaded.command_prefixes.len(), 1);
        assert!(loaded.command_prefixes.contains(&"git ".to_string()));
    }

    #[test]
    fn load_nonexistent_returns_empty() {
        let dir = tempdir().unwrap();
        let loaded = load_approvals(dir.path()).unwrap();

        assert!(loaded.tool_names.is_empty());
        assert!(loaded.command_prefixes.is_empty());
    }

    #[test]
    fn delete_approvals_removes_file() {
        let dir = tempdir().unwrap();
        let approvals = ApprovalsData {
            tool_names: vec!["Read".to_string()],
            command_prefixes: vec![],
        };

        save_approvals(dir.path(), &approvals).unwrap();
        assert!(dir.path().join("approvals.json").exists());

        delete_approvals(dir.path()).unwrap();
        assert!(!dir.path().join("approvals.json").exists());
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let dir = tempdir().unwrap();
        // Should not error even if file doesn't exist
        delete_approvals(dir.path()).unwrap();
    }

    // ------------------------------------------------------------------------
    // Tool Name Tests
    // ------------------------------------------------------------------------

    #[test]
    fn add_tool_name_works() {
        let mut approvals = ApprovalsData::default();

        add_tool_name(&mut approvals, "Read");
        assert_eq!(approvals.tool_names.len(), 1);
        assert!(has_tool_name(&approvals, "Read"));
    }

    #[test]
    fn add_tool_name_deduplicates() {
        let mut approvals = ApprovalsData::default();

        add_tool_name(&mut approvals, "Read");
        add_tool_name(&mut approvals, "Read"); // Duplicate
        add_tool_name(&mut approvals, "Glob");

        assert_eq!(approvals.tool_names.len(), 2);
    }

    #[test]
    fn remove_tool_name_works() {
        let mut approvals = ApprovalsData {
            tool_names: vec!["Read".to_string(), "Glob".to_string()],
            command_prefixes: vec![],
        };

        remove_tool_name(&mut approvals, "Read");
        assert_eq!(approvals.tool_names.len(), 1);
        assert!(!has_tool_name(&approvals, "Read"));
        assert!(has_tool_name(&approvals, "Glob"));
    }

    #[test]
    fn remove_nonexistent_tool_is_ok() {
        let mut approvals = ApprovalsData::default();
        // Should not error
        remove_tool_name(&mut approvals, "NonExistent");
        assert!(approvals.tool_names.is_empty());
    }

    // ------------------------------------------------------------------------
    // Command Prefix Tests
    // ------------------------------------------------------------------------

    #[test]
    fn add_command_prefix_works() {
        let mut approvals = ApprovalsData::default();

        add_command_prefix(&mut approvals, "git ");
        assert_eq!(approvals.command_prefixes.len(), 1);
        assert!(has_command_prefix(&approvals, "git "));
    }

    #[test]
    fn add_command_prefix_deduplicates() {
        let mut approvals = ApprovalsData::default();

        add_command_prefix(&mut approvals, "git ");
        add_command_prefix(&mut approvals, "git "); // Duplicate
        add_command_prefix(&mut approvals, "npm ");

        assert_eq!(approvals.command_prefixes.len(), 2);
    }

    #[test]
    fn remove_command_prefix_works() {
        let mut approvals = ApprovalsData {
            tool_names: vec![],
            command_prefixes: vec!["git ".to_string(), "npm ".to_string()],
        };

        remove_command_prefix(&mut approvals, "git ");
        assert_eq!(approvals.command_prefixes.len(), 1);
        assert!(!has_command_prefix(&approvals, "git "));
        assert!(has_command_prefix(&approvals, "npm "));
    }

    #[test]
    fn command_matches_prefix_works() {
        let approvals = ApprovalsData {
            tool_names: vec![],
            command_prefixes: vec!["git ".to_string(), "npm ".to_string()],
        };

        // Should match
        assert!(command_matches_prefix(&approvals, "git status"));
        assert!(command_matches_prefix(&approvals, "git commit -m 'test'"));
        assert!(command_matches_prefix(&approvals, "npm install"));

        // Should not match
        assert!(!command_matches_prefix(&approvals, "rm -rf /"));
        assert!(!command_matches_prefix(&approvals, "github-cli")); // Missing space
        assert!(!command_matches_prefix(&approvals, "cargo build"));
    }

    #[test]
    fn command_matches_empty_prefixes() {
        let approvals = ApprovalsData::default();

        // No prefixes approved, nothing should match
        assert!(!command_matches_prefix(&approvals, "git status"));
        assert!(!command_matches_prefix(&approvals, "ls"));
    }

    // ------------------------------------------------------------------------
    // Integration Tests
    // ------------------------------------------------------------------------

    #[test]
    fn full_workflow() {
        let dir = tempdir().unwrap();

        // Start fresh
        let mut approvals = load_approvals(dir.path()).unwrap();
        assert!(approvals.tool_names.is_empty());

        // Add some approvals
        add_tool_name(&mut approvals, "Read");
        add_tool_name(&mut approvals, "Glob");
        add_command_prefix(&mut approvals, "git ");
        add_command_prefix(&mut approvals, "cargo ");

        // Save
        save_approvals(dir.path(), &approvals).unwrap();

        // Reload and verify
        let loaded = load_approvals(dir.path()).unwrap();
        assert!(has_tool_name(&loaded, "Read"));
        assert!(has_tool_name(&loaded, "Glob"));
        assert!(command_matches_prefix(&loaded, "git status"));
        assert!(command_matches_prefix(&loaded, "cargo build"));
        assert!(!command_matches_prefix(&loaded, "npm install"));

        // Remove some
        let mut approvals = loaded;
        remove_tool_name(&mut approvals, "Glob");
        remove_command_prefix(&mut approvals, "git ");
        save_approvals(dir.path(), &approvals).unwrap();

        // Verify removal
        let loaded = load_approvals(dir.path()).unwrap();
        assert!(has_tool_name(&loaded, "Read"));
        assert!(!has_tool_name(&loaded, "Glob"));
        assert!(!command_matches_prefix(&loaded, "git status"));
        assert!(command_matches_prefix(&loaded, "cargo build"));
    }
}
