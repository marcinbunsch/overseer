//! Approval context for tracking what's been approved.

use super::safe_commands::SAFE_COMMANDS;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Context for approval decisions.
///
/// Tracks which tools and command prefixes have been approved,
/// and provides the `should_auto_approve` method for making
/// approval decisions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApprovalContext {
    /// Tools that have been approved (e.g., "Bash", "Edit", "Write").
    pub approved_tools: HashSet<String>,

    /// Command prefixes that have been approved (e.g., "npm install").
    pub approved_prefixes: HashSet<String>,
}

impl ApprovalContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if a tool call should auto-approve.
    ///
    /// Returns true if:
    /// - The tool is in the approved_tools set, OR
    /// - All command prefixes are in the approved_prefixes set, OR
    /// - All command prefixes are in the SAFE_COMMANDS set
    pub fn should_auto_approve(&self, tool_name: &str, prefixes: &[String]) -> bool {
        // Check if tool is approved
        if self.approved_tools.contains(tool_name) {
            return true;
        }

        // For non-Bash tools, only the tool name matters
        if prefixes.is_empty() {
            return false;
        }

        // Check if all prefixes are approved or safe
        prefixes.iter().all(|prefix| {
            self.approved_prefixes.contains(prefix) || SAFE_COMMANDS.contains(prefix.as_str())
        })
    }

    /// Add a tool to the approved set.
    pub fn add_tool(&mut self, tool: String) {
        self.approved_tools.insert(tool);
    }

    /// Add a command prefix to the approved set.
    pub fn add_prefix(&mut self, prefix: String) {
        self.approved_prefixes.insert(prefix);
    }

    /// Remove a tool from the approved set.
    pub fn remove_tool(&mut self, tool: &str) {
        self.approved_tools.remove(tool);
    }

    /// Remove a prefix from the approved set.
    pub fn remove_prefix(&mut self, prefix: &str) {
        self.approved_prefixes.remove(prefix);
    }

    /// Clear all approvals.
    pub fn clear(&mut self) {
        self.approved_tools.clear();
        self.approved_prefixes.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_approve_safe_command() {
        let ctx = ApprovalContext::new();
        assert!(ctx.should_auto_approve("Bash", &["git status".to_string()]));
    }

    #[test]
    fn deny_unsafe_command() {
        let ctx = ApprovalContext::new();
        assert!(!ctx.should_auto_approve("Bash", &["rm -rf".to_string()]));
    }

    #[test]
    fn auto_approve_approved_tool() {
        let mut ctx = ApprovalContext::new();
        ctx.add_tool("Edit".to_string());
        assert!(ctx.should_auto_approve("Edit", &[]));
    }

    #[test]
    fn auto_approve_approved_prefix() {
        let mut ctx = ApprovalContext::new();
        ctx.add_prefix("npm install".to_string());
        assert!(ctx.should_auto_approve("Bash", &["npm install".to_string()]));
    }

    #[test]
    fn deny_when_one_prefix_not_approved() {
        let mut ctx = ApprovalContext::new();
        ctx.add_prefix("npm install".to_string());
        assert!(
            !ctx.should_auto_approve("Bash", &["npm install".to_string(), "rm -rf".to_string()])
        );
    }

    #[test]
    fn approve_mixed_safe_and_approved() {
        let mut ctx = ApprovalContext::new();
        ctx.add_prefix("npm install".to_string());
        assert!(ctx.should_auto_approve(
            "Bash",
            &["git status".to_string(), "npm install".to_string()]
        ));
    }
}
