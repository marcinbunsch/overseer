//! Overseer action parsing and execution.
//!
//! Extracts `\`\`\`overseer` blocks from agent output and converts
//! them to structured actions.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

static OVERSEER_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"```overseer\s*\n([\s\S]*?)\n```").unwrap());

/// An action that Overseer should perform.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum OverseerAction {
    /// Open a pull request.
    OpenPr {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        body: Option<String>,
    },

    /// Merge the current branch.
    MergeBranch { into: String },

    /// Rename the chat.
    RenameChat { title: String },
}

/// Extract overseer action blocks from content.
///
/// Returns the cleaned content (with blocks removed) and the list of actions.
pub fn extract_overseer_blocks(content: &str) -> (String, Vec<OverseerAction>) {
    let mut actions = Vec::new();
    let mut clean_content = content.to_string();

    // Find all matches (collect first to get indices)
    let matches: Vec<_> = OVERSEER_BLOCK_RE.find_iter(content).collect();

    // Process in reverse order to preserve indices when removing
    for m in matches.into_iter().rev() {
        // Extract the JSON content from the capture group
        if let Some(captures) = OVERSEER_BLOCK_RE.captures(m.as_str()) {
            if let Some(json_match) = captures.get(1) {
                let json_content = json_match.as_str().trim();
                if let Ok(action) = serde_json::from_str::<OverseerAction>(json_content) {
                    actions.push(action);
                }
            }
        }

        // Remove the block from content
        clean_content.replace_range(m.range(), "");
    }

    // Reverse to maintain original order
    actions.reverse();

    // Clean up extra whitespace
    clean_content = clean_content.trim().to_string();
    // Collapse multiple newlines
    while clean_content.contains("\n\n\n") {
        clean_content = clean_content.replace("\n\n\n", "\n\n");
    }

    (clean_content, actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_rename_chat() {
        let content = r#"Here's the result.

```overseer
{"action": "rename_chat", "title": "Fix login bug"}
```

All done!"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "Here's the result.\n\nAll done!");
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::RenameChat { title } => {
                assert_eq!(title, "Fix login bug");
            }
            _ => panic!("Expected RenameChat action"),
        }
    }

    #[test]
    fn extract_open_pr() {
        let content = r#"```overseer
{"action": "open_pr", "title": "Add login feature", "body": "This PR adds login."}
```"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "");
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::OpenPr { title, body } => {
                assert_eq!(title, "Add login feature");
                assert_eq!(body.as_deref(), Some("This PR adds login."));
            }
            _ => panic!("Expected OpenPr action"),
        }
    }

    #[test]
    fn extract_multiple_actions() {
        let content = r#"Done!

```overseer
{"action": "rename_chat", "title": "Test"}
```

Also:

```overseer
{"action": "merge_branch", "into": "main"}
```"#;

        let (_, actions) = extract_overseer_blocks(content);
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn invalid_json_ignored() {
        let content = r#"```overseer
not valid json
```"#;

        let (clean, actions) = extract_overseer_blocks(content);
        assert!(actions.is_empty());
        assert_eq!(clean, "");
    }

    #[test]
    fn no_blocks() {
        let content = "Just regular text.";
        let (clean, actions) = extract_overseer_blocks(content);
        assert_eq!(clean, content);
        assert!(actions.is_empty());
    }
}
