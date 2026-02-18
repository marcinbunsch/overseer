//! Safe commands that auto-approve.

use std::collections::HashSet;
use std::sync::LazyLock;

/// Commands that are safe to auto-approve.
///
/// These are read-only or low-risk commands that don't modify
/// the filesystem or execute arbitrary code.
pub static SAFE_COMMANDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        // Git read operations
        "git status",
        "git diff",
        "git log",
        "git show",
        "git branch",
        "git remote",
        "git rev-parse",
        "git symbolic-ref",
        "git config",
        "git ls-files",
        "git ls-tree",
        "git cat-file",
        "git describe",
        "git shortlog",
        "git blame",
        "git reflog",
        "git stash list",
        "git tag",
        "git worktree list",
        // GitHub CLI read operations
        "gh pr list",
        "gh pr view",
        "gh pr status",
        "gh pr checks",
        "gh pr diff",
        "gh issue list",
        "gh issue view",
        "gh issue status",
        "gh repo view",
        "gh api",
    ]
    .into_iter()
    .collect()
});

/// Commands that take arguments directly (first word is the command).
///
/// For these commands, we only look at the first word to determine
/// the command prefix, not the first two words.
pub static SINGLE_WORD_COMMANDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        // Shell/scripting
        "cd",
        "ls",
        "cat",
        "head",
        "tail",
        "less",
        "more",
        "echo",
        "printf",
        "true",
        "false",
        "test",
        "exit",
        "return",
        "break",
        "continue",
        "export",
        "unset",
        "local",
        "declare",
        "typeset",
        "readonly",
        "set",
        "shopt",
        "alias",
        "unalias",
        "type",
        "which",
        "whereis",
        "whence",
        "command",
        "builtin",
        "enable",
        "hash",
        "help",
        "man",
        "info",
        "apropos",
        // Shell invocation
        "zsh",
        "bash",
        "sh",
        "fish",
        "source",
        "eval",
        // File operations
        "pwd",
        "pushd",
        "popd",
        "dirs",
        "mkdir",
        "rmdir",
        "rm",
        "cp",
        "mv",
        "ln",
        "touch",
        "chmod",
        "chown",
        "chgrp",
        "stat",
        "file",
        "find",
        "locate",
        "xargs",
        "basename",
        "dirname",
        "realpath",
        "readlink",
        // Text processing
        "grep",
        "egrep",
        "fgrep",
        "rg",
        "ag",
        "ack",
        "sed",
        "awk",
        "gawk",
        "mawk",
        "cut",
        "paste",
        "join",
        "sort",
        "uniq",
        "comm",
        "diff",
        "patch",
        "tr",
        "wc",
        "nl",
        "fold",
        "fmt",
        "pr",
        "column",
        "expand",
        "unexpand",
        "tac",
        "rev",
        "shuf",
        // Process/system
        "ps",
        "top",
        "htop",
        "kill",
        "pkill",
        "killall",
        "pgrep",
        "jobs",
        "fg",
        "bg",
        "wait",
        "nohup",
        "nice",
        "renice",
        "time",
        "timeout",
        "watch",
        "sleep",
        "date",
        "cal",
        "uptime",
        "hostname",
        "uname",
        "whoami",
        "id",
        "groups",
        "users",
        "who",
        "w",
        "last",
        "lastlog",
        "env",
        "printenv",
        // Network
        "curl",
        "wget",
        "ping",
        "traceroute",
        "dig",
        "nslookup",
        "host",
        "nc",
        "netcat",
        "ssh",
        "scp",
        "sftp",
        "rsync",
        "ftp",
        // Archive
        "tar",
        "gzip",
        "gunzip",
        "bzip2",
        "bunzip2",
        "xz",
        "unxz",
        "zip",
        "unzip",
        "7z",
        // Development
        "python",
        "python3",
        "node",
        "deno",
        "bun",
        "ruby",
        "perl",
        "php",
        "rustc",
        "make",
        "cmake",
        "gcc",
        "g++",
        "clang",
        "clang++",
        "javac",
        "java",
        // NOTE: cargo, go, mvn, gradle are intentionally NOT here.
        // They have subcommands like "cargo test", "go build", "mvn install"
        // that we want to track separately.
        // NOTE: Package managers (npm, yarn, pnpm, pip, gem, brew, apt, etc.)
        // are intentionally NOT here. We want their subcommands like
        // "npm install", "yarn add", "brew install", etc.
        // Misc
        "jq",
        "yq",
        "base64",
        "md5sum",
        "sha256sum",
        "openssl",
        "tee",
        "xclip",
        "pbcopy",
        "pbpaste",
        "open",
        "xdg-open",
    ]
    .into_iter()
    .collect()
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_commands_contains_git_status() {
        assert!(SAFE_COMMANDS.contains("git status"));
    }

    #[test]
    fn single_word_commands_contains_ls() {
        assert!(SINGLE_WORD_COMMANDS.contains("ls"));
    }
}
