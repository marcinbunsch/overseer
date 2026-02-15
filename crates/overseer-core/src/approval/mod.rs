//! Tool approval logic.
//!
//! Determines whether tools should auto-approve based on:
//! - Safe commands list (git status, git diff, etc.)
//! - User-approved tools
//! - User-approved command prefixes

mod command_parser;
mod context;
mod safe_commands;

pub use command_parser::parse_command_prefixes;
pub use context::ApprovalContext;
pub use safe_commands::{SAFE_COMMANDS, SINGLE_WORD_COMMANDS};

/// Check if all command prefixes are safe (read-only operations that don't require approval).
///
/// Returns true only if the prefixes list is non-empty and all prefixes are in SAFE_COMMANDS.
pub fn are_commands_safe(prefixes: &[String]) -> bool {
    if prefixes.is_empty() {
        return false;
    }
    prefixes
        .iter()
        .all(|p| SAFE_COMMANDS.contains(p.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn are_commands_safe_returns_false_for_empty() {
        assert!(!are_commands_safe(&[]));
    }

    #[test]
    fn are_commands_safe_returns_true_for_git_status() {
        assert!(are_commands_safe(&["git status".to_string()]));
    }

    #[test]
    fn are_commands_safe_returns_true_for_multiple_safe() {
        assert!(are_commands_safe(&[
            "git status".to_string(),
            "git diff".to_string(),
            "git log".to_string(),
        ]));
    }

    #[test]
    fn are_commands_safe_returns_false_for_unsafe() {
        assert!(!are_commands_safe(&["rm".to_string()]));
    }

    #[test]
    fn are_commands_safe_returns_false_when_one_unsafe() {
        assert!(!are_commands_safe(&[
            "git status".to_string(),
            "npm install".to_string(),
        ]));
    }

    #[test]
    fn are_commands_safe_returns_false_for_git_push() {
        // git push is not in SAFE_COMMANDS (it modifies remote)
        assert!(!are_commands_safe(&["git push".to_string()]));
    }
}
