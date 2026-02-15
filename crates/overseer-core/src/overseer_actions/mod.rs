//! Overseer action parsing and execution.
//!
//! Extracts `\`\`\`overseer` blocks from agent output and converts
//! them to structured actions.
//!
//! The protocol format is:
//! ```text
//! ```overseer
//! {"action": "<action_name>", "params": {...}}
//! ```
//! ```

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

static OVERSEER_BLOCK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"```overseer\s*\n([\s\S]*?)\n```").unwrap());

/// Parameters for the open_pr action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenPrParams {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// Parameters for the merge_branch action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MergeBranchParams {
    pub into: String,
}

/// Parameters for the rename_chat action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RenameChatParams {
    pub title: String,
}

/// An action that Overseer should perform.
///
/// Actions use the format: `{"action": "<name>", "params": {...}}`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum OverseerAction {
    /// Open a pull request.
    OpenPr { params: OpenPrParams },

    /// Merge the current branch.
    MergeBranch { params: MergeBranchParams },

    /// Rename the chat.
    RenameChat { params: RenameChatParams },
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
{"action": "rename_chat", "params": {"title": "Fix login bug"}}
```

All done!"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "Here's the result.\n\nAll done!");
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::RenameChat { params } => {
                assert_eq!(params.title, "Fix login bug");
            }
            _ => panic!("Expected RenameChat action"),
        }
    }

    #[test]
    fn extract_open_pr() {
        let content = r#"```overseer
{"action": "open_pr", "params": {"title": "Add login feature", "body": "This PR adds login."}}
```"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "");
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::OpenPr { params } => {
                assert_eq!(params.title, "Add login feature");
                assert_eq!(params.body.as_deref(), Some("This PR adds login."));
            }
            _ => panic!("Expected OpenPr action"),
        }
    }

    #[test]
    fn extract_multiple_actions() {
        let content = r#"Done!

```overseer
{"action": "rename_chat", "params": {"title": "Test"}}
```

Also:

```overseer
{"action": "merge_branch", "params": {"into": "main"}}
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

    #[test]
    fn extract_merge_branch() {
        let content = r#"```overseer
{"action": "merge_branch", "params": {"into": "develop"}}
```"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "");
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::MergeBranch { params } => {
                assert_eq!(params.into, "develop");
            }
            _ => panic!("Expected MergeBranch action"),
        }
    }

    #[test]
    fn open_pr_without_body() {
        let content = r#"```overseer
{"action": "open_pr", "params": {"title": "Quick fix"}}
```"#;

        let (_, actions) = extract_overseer_blocks(content);

        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::OpenPr { params } => {
                assert_eq!(params.title, "Quick fix");
                assert!(params.body.is_none());
            }
            _ => panic!("Expected OpenPr action"),
        }
    }

    #[test]
    fn block_at_start_of_content() {
        let content = r#"```overseer
{"action": "rename_chat", "params": {"title": "Test"}}
```
Some text after."#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "Some text after.");
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn block_at_end_of_content() {
        let content = r#"Some text before.
```overseer
{"action": "rename_chat", "params": {"title": "Test"}}
```"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert_eq!(clean, "Some text before.");
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn multiple_newlines_collapsed() {
        let content = r#"Text before.


```overseer
{"action": "rename_chat", "params": {"title": "Test"}}
```


Text after."#;

        let (clean, _) = extract_overseer_blocks(content);

        // Multiple newlines should be collapsed to at most 2
        assert!(!clean.contains("\n\n\n"));
    }

    #[test]
    fn preserves_order_of_multiple_actions() {
        let content = r#"```overseer
{"action": "rename_chat", "params": {"title": "First"}}
```

```overseer
{"action": "merge_branch", "params": {"into": "main"}}
```

```overseer
{"action": "open_pr", "params": {"title": "Third"}}
```"#;

        let (_, actions) = extract_overseer_blocks(content);

        assert_eq!(actions.len(), 3);
        assert!(
            matches!(&actions[0], OverseerAction::RenameChat { params } if params.title == "First")
        );
        assert!(
            matches!(&actions[1], OverseerAction::MergeBranch { params } if params.into == "main")
        );
        assert!(
            matches!(&actions[2], OverseerAction::OpenPr { params } if params.title == "Third")
        );
    }

    #[test]
    fn unknown_action_ignored() {
        let content = r#"```overseer
{"action": "unknown_action", "params": {"data": "something"}}
```"#;

        let (clean, actions) = extract_overseer_blocks(content);

        assert!(actions.is_empty());
        assert_eq!(clean, "");
    }

    #[test]
    fn action_serialization_roundtrip() {
        let action = OverseerAction::RenameChat {
            params: RenameChatParams {
                title: "My Chat".to_string(),
            },
        };
        let json = serde_json::to_string(&action).unwrap();
        let parsed: OverseerAction = serde_json::from_str(&json).unwrap();

        match parsed {
            OverseerAction::RenameChat { params } => assert_eq!(params.title, "My Chat"),
            _ => panic!("Expected RenameChat"),
        }
    }

    #[test]
    fn open_pr_serialization_roundtrip() {
        let action = OverseerAction::OpenPr {
            params: OpenPrParams {
                title: "Add feature".to_string(),
                body: Some("This adds a new feature.".to_string()),
            },
        };
        let json = serde_json::to_string(&action).unwrap();
        let parsed: OverseerAction = serde_json::from_str(&json).unwrap();

        match parsed {
            OverseerAction::OpenPr { params } => {
                assert_eq!(params.title, "Add feature");
                assert_eq!(params.body, Some("This adds a new feature.".to_string()));
            }
            _ => panic!("Expected OpenPr"),
        }
    }

    #[test]
    fn merge_branch_serialization_roundtrip() {
        let action = OverseerAction::MergeBranch {
            params: MergeBranchParams {
                into: "main".to_string(),
            },
        };
        let json = serde_json::to_string(&action).unwrap();
        let parsed: OverseerAction = serde_json::from_str(&json).unwrap();

        match parsed {
            OverseerAction::MergeBranch { params } => assert_eq!(params.into, "main"),
            _ => panic!("Expected MergeBranch"),
        }
    }

    #[test]
    fn whitespace_in_json_block() {
        let content = r#"```overseer

  {"action": "rename_chat", "params": {"title": "Test"}}

```"#;

        let (_, actions) = extract_overseer_blocks(content);

        assert_eq!(actions.len(), 1);
        match &actions[0] {
            OverseerAction::RenameChat { params } => assert_eq!(params.title, "Test"),
            _ => panic!("Expected RenameChat"),
        }
    }

    #[test]
    fn mixed_valid_and_invalid_blocks() {
        let content = r#"```overseer
{"action": "rename_chat", "params": {"title": "Valid"}}
```

```overseer
invalid json here
```

```overseer
{"action": "merge_branch", "params": {"into": "main"}}
```"#;

        let (_, actions) = extract_overseer_blocks(content);

        // Should have 2 valid actions, invalid one ignored
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn empty_content() {
        let content = "";
        let (clean, actions) = extract_overseer_blocks(content);
        assert_eq!(clean, "");
        assert!(actions.is_empty());
    }

    #[test]
    fn only_whitespace() {
        let content = "   \n\n   ";
        let (clean, actions) = extract_overseer_blocks(content);
        assert_eq!(clean, "");
        assert!(actions.is_empty());
    }

    #[test]
    fn missing_params_rejected() {
        // Without params field, the action should be rejected
        let content = r#"```overseer
{"action": "rename_chat"}
```"#;

        let (_, actions) = extract_overseer_blocks(content);
        assert!(actions.is_empty());
    }

    #[test]
    fn missing_required_field_rejected() {
        // params exists but required field is missing
        let content = r#"```overseer
{"action": "open_pr", "params": {}}
```"#;

        let (_, actions) = extract_overseer_blocks(content);
        assert!(actions.is_empty());
    }

    #[test]
    fn params_struct_equality() {
        let params1 = OpenPrParams {
            title: "Test".to_string(),
            body: Some("Body".to_string()),
        };
        let params2 = OpenPrParams {
            title: "Test".to_string(),
            body: Some("Body".to_string()),
        };
        assert_eq!(params1, params2);
    }

    #[test]
    fn action_equality() {
        let action1 = OverseerAction::RenameChat {
            params: RenameChatParams {
                title: "Test".to_string(),
            },
        };
        let action2 = OverseerAction::RenameChat {
            params: RenameChatParams {
                title: "Test".to_string(),
            },
        };
        assert_eq!(action1, action2);
    }
}
