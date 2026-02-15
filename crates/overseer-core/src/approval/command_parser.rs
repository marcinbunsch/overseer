//! Command prefix parsing.
//!
//! Extracts command prefixes from bash commands, handling:
//! - Chained commands (&&, ||, ;, |)
//! - Single-word vs multi-word commands
//! - Flag skipping for multi-word commands (including flag values)

use super::safe_commands::SINGLE_WORD_COMMANDS;
use regex::Regex;
use std::sync::LazyLock;

/// Regex for single-letter flags like -c, -v, -x
static SINGLE_LETTER_FLAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^-[a-zA-Z]$").unwrap());

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
    // Skip flags (words starting with -) and their values for single-letter flags
    let mut i = 1;
    while i < words.len() {
        let word = words[i];

        if word.starts_with('-') {
            // If it's a single-letter flag (like -c) and the next word doesn't start with -,
            // skip it too (it's likely the flag's value)
            if SINGLE_LETTER_FLAG.is_match(word) && i + 1 < words.len() {
                let next_word = words[i + 1];
                if !next_word.starts_with('-') {
                    i += 1; // Skip the flag's value
                }
            }
            i += 1;
            continue;
        }

        // Found the subcommand!
        return Some(format!("{first_word} {word}"));
    }

    // No subcommand found, just return the first word
    Some(first_word.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================
    // Single Commands - Single Word
    // ============================================

    mod single_word_commands {
        use super::*;

        #[test]
        fn cd_with_path() {
            assert_eq!(parse_command_prefixes("cd /some/path"), vec!["cd"]);
        }

        #[test]
        fn zsh_with_flags() {
            assert_eq!(parse_command_prefixes("zsh -l -c 'echo foo'"), vec!["zsh"]);
        }

        #[test]
        fn bash_with_flag() {
            assert_eq!(
                parse_command_prefixes("bash -c 'npm install'"),
                vec!["bash"]
            );
        }

        #[test]
        fn ls_with_flags() {
            assert_eq!(parse_command_prefixes("ls -la /some/dir"), vec!["ls"]);
        }

        #[test]
        fn python_with_script() {
            assert_eq!(
                parse_command_prefixes("python script.py --flag"),
                vec!["python"]
            );
        }

        #[test]
        fn python3_with_script() {
            assert_eq!(parse_command_prefixes("python3 script.py"), vec!["python3"]);
        }

        #[test]
        fn node_with_script() {
            assert_eq!(parse_command_prefixes("node index.js"), vec!["node"]);
        }

        #[test]
        fn make_with_target() {
            assert_eq!(parse_command_prefixes("make build"), vec!["make"]);
        }

        #[test]
        fn touch_file() {
            assert_eq!(parse_command_prefixes("touch file.txt"), vec!["touch"]);
        }

        #[test]
        fn mkdir_with_flag() {
            assert_eq!(parse_command_prefixes("mkdir -p dir"), vec!["mkdir"]);
        }

        #[test]
        fn rm_with_flags() {
            assert_eq!(parse_command_prefixes("rm -rf dir"), vec!["rm"]);
        }

        #[test]
        fn cp_files() {
            assert_eq!(parse_command_prefixes("cp src dst"), vec!["cp"]);
        }

        #[test]
        fn mv_files() {
            assert_eq!(parse_command_prefixes("mv old new"), vec!["mv"]);
        }

        #[test]
        fn chmod_file() {
            assert_eq!(parse_command_prefixes("chmod 755 file"), vec!["chmod"]);
        }

        #[test]
        fn deno_run() {
            assert_eq!(parse_command_prefixes("deno run app.ts"), vec!["deno"]);
        }

        #[test]
        fn bun_run() {
            assert_eq!(parse_command_prefixes("bun run script.ts"), vec!["bun"]);
        }

        #[test]
        fn echo_hello() {
            assert_eq!(parse_command_prefixes("echo hello"), vec!["echo"]);
        }

        #[test]
        fn pwd_alone() {
            assert_eq!(parse_command_prefixes("pwd"), vec!["pwd"]);
        }

        #[test]
        fn which_node() {
            assert_eq!(parse_command_prefixes("which node"), vec!["which"]);
        }

        #[test]
        fn grep_pattern() {
            assert_eq!(parse_command_prefixes("grep pattern file"), vec!["grep"]);
        }

        #[test]
        fn curl_url() {
            assert_eq!(
                parse_command_prefixes("curl https://example.com"),
                vec!["curl"]
            );
        }

        #[test]
        fn tar_extract() {
            assert_eq!(
                parse_command_prefixes("tar -xzf archive.tar.gz"),
                vec!["tar"]
            );
        }

        #[test]
        fn ruby_script() {
            assert_eq!(parse_command_prefixes("ruby script.rb"), vec!["ruby"]);
        }

        #[test]
        fn cmake_build() {
            assert_eq!(parse_command_prefixes("cmake .."), vec!["cmake"]);
        }

        #[test]
        fn fish_shell() {
            assert_eq!(parse_command_prefixes("fish -c 'echo'"), vec!["fish"]);
        }

        #[test]
        fn source_bashrc() {
            assert_eq!(parse_command_prefixes("source ~/.bashrc"), vec!["source"]);
        }

        #[test]
        fn eval_command() {
            assert_eq!(parse_command_prefixes("eval 'echo test'"), vec!["eval"]);
        }

        #[test]
        fn sh_script() {
            assert_eq!(parse_command_prefixes("sh script.sh"), vec!["sh"]);
        }
    }

    // ============================================
    // Multi-Word Commands (have subcommands)
    // ============================================

    mod multi_word_commands {
        use super::*;

        #[test]
        fn git_status() {
            assert_eq!(parse_command_prefixes("git status"), vec!["git status"]);
        }

        #[test]
        fn git_commit() {
            assert_eq!(
                parse_command_prefixes("git commit -m 'message'"),
                vec!["git commit"]
            );
        }

        #[test]
        fn git_push() {
            assert_eq!(
                parse_command_prefixes("git push origin main"),
                vec!["git push"]
            );
        }

        #[test]
        fn git_pull() {
            assert_eq!(
                parse_command_prefixes("git pull --rebase"),
                vec!["git pull"]
            );
        }

        #[test]
        fn git_add() {
            assert_eq!(parse_command_prefixes("git add ."), vec!["git add"]);
        }

        #[test]
        fn npm_install() {
            assert_eq!(
                parse_command_prefixes("npm install lodash"),
                vec!["npm install"]
            );
        }

        #[test]
        fn npm_run() {
            assert_eq!(parse_command_prefixes("npm run build"), vec!["npm run"]);
        }

        #[test]
        fn npm_test() {
            assert_eq!(parse_command_prefixes("npm test"), vec!["npm test"]);
        }

        #[test]
        fn pnpm_install() {
            assert_eq!(parse_command_prefixes("pnpm install"), vec!["pnpm install"]);
        }

        #[test]
        fn pnpm_test() {
            assert_eq!(
                parse_command_prefixes("pnpm test --watch"),
                vec!["pnpm test"]
            );
        }

        #[test]
        fn pnpm_run() {
            assert_eq!(parse_command_prefixes("pnpm run dev"), vec!["pnpm run"]);
        }

        #[test]
        fn yarn_add() {
            assert_eq!(parse_command_prefixes("yarn add react"), vec!["yarn add"]);
        }

        #[test]
        fn docker_build() {
            assert_eq!(
                parse_command_prefixes("docker build -t myimage ."),
                vec!["docker build"]
            );
        }

        #[test]
        fn docker_run() {
            assert_eq!(
                parse_command_prefixes("docker run -it ubuntu"),
                vec!["docker run"]
            );
        }

        #[test]
        fn docker_compose() {
            assert_eq!(
                parse_command_prefixes("docker compose up"),
                vec!["docker compose"]
            );
        }

        #[test]
        fn kubectl_get() {
            assert_eq!(
                parse_command_prefixes("kubectl get pods"),
                vec!["kubectl get"]
            );
        }

        #[test]
        fn kubectl_apply() {
            assert_eq!(
                parse_command_prefixes("kubectl apply -f"),
                vec!["kubectl apply"]
            );
        }

        #[test]
        fn brew_install() {
            assert_eq!(
                parse_command_prefixes("brew install node"),
                vec!["brew install"]
            );
        }

        #[test]
        fn cargo_build() {
            assert_eq!(
                parse_command_prefixes("cargo build --release"),
                vec!["cargo build"]
            );
        }

        #[test]
        fn cargo_run() {
            assert_eq!(
                parse_command_prefixes("cargo run --release"),
                vec!["cargo run"]
            );
        }

        #[test]
        fn cargo_test() {
            assert_eq!(parse_command_prefixes("cargo test"), vec!["cargo test"]);
        }

        #[test]
        fn gh_pr() {
            assert_eq!(
                parse_command_prefixes("gh pr create --title 'Fix'"),
                vec!["gh pr"]
            );
        }

        #[test]
        fn gh_issue() {
            assert_eq!(parse_command_prefixes("gh issue list"), vec!["gh issue"]);
        }
    }

    // ============================================
    // Chained Commands
    // ============================================

    mod chained_commands {
        use super::*;

        #[test]
        fn and_chain_simple() {
            assert_eq!(
                parse_command_prefixes("cd /foo && pnpm install"),
                vec!["cd", "pnpm install"]
            );
        }

        #[test]
        fn and_chain_multiple() {
            assert_eq!(
                parse_command_prefixes("cd /foo && pnpm install && pnpm test"),
                vec!["cd", "pnpm install", "pnpm test"]
            );
        }

        #[test]
        fn or_chain() {
            assert_eq!(
                parse_command_prefixes("npm test || echo 'tests failed'"),
                vec!["npm test", "echo"]
            );
        }

        #[test]
        fn semicolon_chain() {
            assert_eq!(
                parse_command_prefixes("cd /app; npm install"),
                vec!["cd", "npm install"]
            );
        }

        #[test]
        fn pipe_chain() {
            assert_eq!(
                parse_command_prefixes("cat file.txt | grep pattern"),
                vec!["cat", "grep"]
            );
        }

        #[test]
        fn mixed_chain_and_git() {
            assert_eq!(
                parse_command_prefixes("cd /foo && git add . && git commit -m 'msg'"),
                vec!["cd", "git add", "git commit"]
            );
        }

        #[test]
        fn complex_chain() {
            assert_eq!(
                parse_command_prefixes("git status && npm install; ls -la | grep node_modules"),
                vec!["git status", "npm install", "ls", "grep"]
            );
        }
    }

    // ============================================
    // Flag Handling
    // ============================================

    mod flag_handling {
        use super::*;

        #[test]
        fn git_no_pager_status() {
            assert_eq!(
                parse_command_prefixes("git --no-pager status"),
                vec!["git status"]
            );
        }

        #[test]
        fn git_multiple_flags() {
            assert_eq!(
                parse_command_prefixes("git -c color.ui=false --no-pager diff"),
                vec!["git diff"]
            );
        }

        #[test]
        fn git_only_flags_no_subcommand() {
            assert_eq!(parse_command_prefixes("git --version"), vec!["git"]);
        }

        #[test]
        fn single_letter_flag_with_value() {
            // -c is a single-letter flag, value should be skipped
            assert_eq!(
                parse_command_prefixes("git -c user.name=foo status"),
                vec!["git status"]
            );
        }
    }

    // ============================================
    // Edge Cases
    // ============================================

    mod edge_cases {
        use super::*;

        #[test]
        fn empty_command() {
            assert!(parse_command_prefixes("").is_empty());
        }

        #[test]
        fn whitespace_only() {
            assert!(parse_command_prefixes("   ").is_empty());
        }

        #[test]
        fn leading_whitespace() {
            assert_eq!(parse_command_prefixes("  cd /foo"), vec!["cd"]);
        }

        #[test]
        fn single_word_no_args() {
            assert_eq!(parse_command_prefixes("pwd"), vec!["pwd"]);
        }

        #[test]
        fn unknown_command_one_word() {
            assert_eq!(parse_command_prefixes("mycommand"), vec!["mycommand"]);
        }

        #[test]
        fn unknown_command_two_words() {
            // Unknown commands use two-word prefix
            assert_eq!(
                parse_command_prefixes("mycommand subcommand arg1"),
                vec!["mycommand subcommand"]
            );
        }

        #[test]
        fn whitespace_between_operators() {
            assert_eq!(
                parse_command_prefixes("cd /foo   &&   git status"),
                vec!["cd", "git status"]
            );
        }

        #[test]
        fn trailing_operator() {
            // Invalid shell syntax, but handle gracefully
            assert_eq!(parse_command_prefixes("cd /foo &&"), vec!["cd"]);
        }

        #[test]
        fn multiple_consecutive_spaces() {
            assert_eq!(
                parse_command_prefixes("git   commit   -m 'test'"),
                vec!["git commit"]
            );
        }
    }

    // ============================================
    // Split on Separators (internal function)
    // ============================================

    mod split_on_separators_tests {
        use super::*;

        #[test]
        fn no_separator() {
            assert_eq!(split_on_separators("git status"), vec!["git status"]);
        }

        #[test]
        fn double_ampersand() {
            assert_eq!(split_on_separators("a && b"), vec!["a ", " b"]);
        }

        #[test]
        fn double_pipe() {
            assert_eq!(split_on_separators("a || b"), vec!["a ", " b"]);
        }

        #[test]
        fn semicolon() {
            assert_eq!(split_on_separators("a; b"), vec!["a", " b"]);
        }

        #[test]
        fn single_pipe() {
            assert_eq!(split_on_separators("a | b"), vec!["a ", " b"]);
        }

        #[test]
        fn multiple_separators() {
            assert_eq!(
                split_on_separators("a && b; c | d || e"),
                vec!["a ", " b", " c ", " d ", " e"]
            );
        }
    }
}
