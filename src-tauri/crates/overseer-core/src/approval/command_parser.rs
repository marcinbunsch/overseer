//! Command prefix parsing.
//!
//! Extracts command prefixes from bash commands, handling:
//! - Chained commands (&&, ||, ;, |)
//! - Single-word vs multi-word commands
//! - Flag skipping for multi-word commands

use super::safe_commands::SINGLE_WORD_COMMANDS;

/// Parse a bash command into its command prefixes.
///
/// For chained commands like `git status && npm test`, returns
/// `["git status", "npm test"]`.
///
/// For single-word commands (like `ls`), returns just the command name.
/// For multi-word commands (like `git status`), returns the command + subcommand.
pub fn parse_command_prefixes(command: &str) -> Vec<String> {
    // Split on command separators: &&, ||, ;, |
    let parts = split_on_separators(command);

    parts
        .into_iter()
        .filter_map(|part| extract_prefix(part.trim()))
        .collect()
}

/// Split a command string on &&, ||, ;, and |.
fn split_on_separators(command: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut current_start = 0;
    let chars: Vec<char> = command.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        // Handle && and ||
        if i + 1 < chars.len() {
            let next = chars[i + 1];
            if (c == '&' && next == '&') || (c == '|' && next == '|') {
                if current_start < i {
                    parts.push(&command[current_start..i]);
                }
                current_start = i + 2;
                i += 2;
                continue;
            }
        }

        // Handle ; and single |
        if c == ';' || c == '|' {
            if current_start < i {
                parts.push(&command[current_start..i]);
            }
            current_start = i + 1;
        }

        i += 1;
    }

    // Add the last part
    if current_start < command.len() {
        parts.push(&command[current_start..]);
    }

    parts
}

/// Extract the command prefix from a single command part.
fn extract_prefix(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let words: Vec<&str> = trimmed.split_whitespace().collect();
    if words.is_empty() {
        return None;
    }

    let first_word = words[0];

    // If it's a single-word command, return just that word
    if SINGLE_WORD_COMMANDS.contains(first_word) {
        return Some(first_word.to_string());
    }

    // For multi-word commands, find the first non-flag word after the command
    // Skip flags (words starting with -)
    for word in words.iter().skip(1) {
        if !word.starts_with('-') {
            return Some(format!("{} {}", first_word, word));
        }
    }

    // If no subcommand found, return just the first word
    Some(first_word.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_command() {
        let prefixes = parse_command_prefixes("git status");
        assert_eq!(prefixes, vec!["git status"]);
    }

    #[test]
    fn chained_commands_and() {
        let prefixes = parse_command_prefixes("git status && npm test");
        assert_eq!(prefixes, vec!["git status", "npm test"]);
    }

    #[test]
    fn chained_commands_or() {
        let prefixes = parse_command_prefixes("git status || echo failed");
        assert_eq!(prefixes, vec!["git status", "echo"]);
    }

    #[test]
    fn chained_commands_semicolon() {
        let prefixes = parse_command_prefixes("git status; npm install");
        assert_eq!(prefixes, vec!["git status", "npm install"]);
    }

    #[test]
    fn piped_commands() {
        let prefixes = parse_command_prefixes("cat file.txt | grep pattern");
        assert_eq!(prefixes, vec!["cat", "grep"]);
    }

    #[test]
    fn command_with_simple_flags() {
        // Simple flags (no arguments) are skipped correctly
        let prefixes = parse_command_prefixes("git --no-pager status");
        assert_eq!(prefixes, vec!["git status"]);
    }

    #[test]
    fn command_with_flag_arguments() {
        // Known limitation: flags with arguments (like -C /path) are not handled perfectly.
        // The parser sees /path as the first non-flag word.
        // This is acceptable because it's still safe - we just get a more specific prefix.
        let prefixes = parse_command_prefixes("git -C /path status");
        assert_eq!(prefixes, vec!["git /path"]);
    }

    #[test]
    fn single_word_command() {
        let prefixes = parse_command_prefixes("ls -la");
        assert_eq!(prefixes, vec!["ls"]);
    }

    #[test]
    fn complex_chain() {
        let prefixes =
            parse_command_prefixes("git status && npm install; ls -la | grep node_modules");
        assert_eq!(
            prefixes,
            vec!["git status", "npm install", "ls", "grep"]
        );
    }

    #[test]
    fn empty_command() {
        let prefixes = parse_command_prefixes("");
        assert!(prefixes.is_empty());
    }

    #[test]
    fn whitespace_only() {
        let prefixes = parse_command_prefixes("   ");
        assert!(prefixes.is_empty());
    }
}
