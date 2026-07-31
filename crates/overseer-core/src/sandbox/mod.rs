//! Optional macOS Seatbelt sandbox for agent processes.
//!
//! When a chat is marked "sandboxed", the agent CLI runs under Apple's
//! `sandbox-exec` with a default-deny profile: it can read and write only its
//! own workspace (plus the git metadata, temp, toolchains, and the one auth
//! path its model needs), and its environment is wiped down to a short
//! allow-list so it can't read the host's secrets.
//!
//! # Two mechanisms
//!
//! - **Filesystem**: [`SandboxProfile`] renders an SBPL profile from a
//!   [`SandboxSpec`]. The spawn layer writes it to a temp file (see
//!   [`SandboxProfileFile`]) and runs `sandbox-exec -f <profile> -- <agent>`.
//! - **Environment**: [`sandbox_env_allowlist`] returns the only variables the
//!   sandboxed process keeps, so the spawn layer can `.env_clear()` first.
//!
//! The types here are cross-platform and pure so they can be unit-tested
//! everywhere. Only the actual `sandbox-exec` wrapping in `shell.rs`/`spawn.rs`
//! is macOS-gated.

mod env;
mod profile;
mod profile_file;

pub use env::sandbox_env_allowlist;
pub use profile::SandboxProfile;
pub use profile_file::SandboxProfileFile;

use std::path::{Path, PathBuf};

/// Which agent CLI is being sandboxed. Selects the filesystem auth hole and the
/// per-agent auth environment variables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
    Copilot,
    OpenCode,
    Pi,
}

impl AgentKind {
    /// Map Overseer's agent-type string (e.g. "claude") to an [`AgentKind`].
    pub fn from_agent_type(agent_type: &str) -> Option<Self> {
        match agent_type {
            "claude" => Some(AgentKind::Claude),
            "codex" => Some(AgentKind::Codex),
            "gemini" => Some(AgentKind::Gemini),
            "copilot" => Some(AgentKind::Copilot),
            "opencode" => Some(AgentKind::OpenCode),
            "pi" => Some(AgentKind::Pi),
            _ => None,
        }
    }
}

/// Everything the sandbox needs to know to box in one agent run.
///
/// Construct with [`SandboxSpec::new`], which resolves absolute paths and fills
/// in the toolchain/rc read-allow list from the current machine. Tests can build
/// the struct directly with explicit paths to keep [`SandboxProfile::render`]
/// pure and machine-independent.
#[derive(Debug, Clone)]
pub struct SandboxSpec {
    /// Which agent CLI this is — picks the auth hole.
    pub agent: AgentKind,
    /// The workspace directory — read+write.
    pub workspace_path: PathBuf,
    /// The shared git directory (`git rev-parse --git-common-dir`) — read+write.
    /// Workspaces are git worktrees whose objects/refs live in the main repo's
    /// `.git`, so git operations need write access there, not just the workspace.
    pub git_common_dir: PathBuf,
    /// The temp directory (`$TMPDIR`) — read+write.
    pub tmpdir: PathBuf,
    /// The user's home directory — used to resolve auth-hole paths.
    pub home: PathBuf,
    /// Extra read-only paths: toolchain caches, shell rc files, and any
    /// user-configured additions. See [`default_read_paths`].
    pub read_paths: Vec<PathBuf>,
    /// Extra environment variables injected into the scrubbed sandbox env, on
    /// top of the allow-list. Used to hand the agent the address and token of
    /// Overseer's internal git API so it can push / open PRs on the host
    /// without the host's GitHub credentials being present in the box.
    pub extra_env: Vec<(String, String)>,
}

impl SandboxSpec {
    /// Build a spec for a real run. Canonicalizes the workspace and git dir,
    /// reads `$TMPDIR`, and seeds `read_paths` with the toolchain/rc paths that
    /// exist on this machine. `extra_read_paths` (from user settings) are added
    /// on top.
    pub fn new(
        agent: AgentKind,
        workspace_path: &Path,
        git_common_dir: &Path,
        home: &Path,
        extra_read_paths: Vec<PathBuf>,
    ) -> Self {
        let mut read_paths = default_read_paths(home);
        read_paths.extend(extra_read_paths);

        SandboxSpec {
            agent,
            workspace_path: canonicalize_or_keep(workspace_path),
            git_common_dir: canonicalize_or_keep(git_common_dir),
            tmpdir: canonicalize_or_keep(&tmpdir()),
            home: home.to_path_buf(),
            read_paths,
            extra_env: Vec::new(),
        }
    }

    /// Set the extra environment variables injected into the scrubbed env.
    pub fn with_extra_env(mut self, extra_env: Vec<(String, String)>) -> Self {
        self.extra_env = extra_env;
        self
    }
}

/// The temp directory the sandbox grants read+write. Uses `$TMPDIR` (per-user
/// under `/var/folders` on macOS) and falls back to `/tmp`.
fn tmpdir() -> PathBuf {
    std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

/// Resolve symlinks to the real path Seatbelt matches against (on macOS
/// `/tmp` -> `/private/tmp`, `/var` -> `/private/var`). Keeps the original path
/// if canonicalization fails (e.g. the path doesn't exist yet).
fn canonicalize_or_keep(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Toolchain caches and shell rc files granted read-only access, filtered to
/// those that exist. Node/pnpm/cargo/rustup read from these; a login shell
/// sources the rc files. This is the main source of "works unsandboxed, breaks
/// sandboxed" — err on the side of including a path.
pub fn default_read_paths(home: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // System-wide toolchain roots (absolute).
    for p in ["/opt/homebrew", "/usr/local"] {
        candidates.push(PathBuf::from(p));
    }

    // Per-user toolchain caches under $HOME.
    for rel in [
        ".nvm",
        ".cargo",
        ".rustup",
        ".npm",
        ".pnpm",
        ".bun",
        ".deno",
        ".volta",
        ".local",
        "Library/pnpm",
        "Library/Caches",
    ] {
        candidates.push(home.join(rel));
    }

    // Login-shell rc files so `$SHELL -l` can source them (keeps PATH tweaks).
    for rel in [
        ".zshrc",
        ".zshenv",
        ".zprofile",
        ".zlogin",
        ".bashrc",
        ".bash_profile",
        ".profile",
    ] {
        candidates.push(home.join(rel));
    }

    // Global git config and excludes. cargo's build-script fingerprinting walks
    // the repo with gix, which reads the user's global config (`~/.gitconfig`,
    // `~/.config/git/config`) and the global excludes it points at (default
    // `~/.config/git/ignore`). Without these `cargo check` fails with "Could not
    // read repository exclude: Operation not permitted". Read-only: the agent
    // never needs to write the host's git config.
    for rel in [".gitconfig", ".config/git"] {
        candidates.push(home.join(rel));
    }

    candidates.into_iter().filter(|p| p.exists()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_kind_from_agent_type_maps_known_agents() {
        assert_eq!(
            AgentKind::from_agent_type("claude"),
            Some(AgentKind::Claude)
        );
        assert_eq!(AgentKind::from_agent_type("codex"), Some(AgentKind::Codex));
        assert_eq!(
            AgentKind::from_agent_type("gemini"),
            Some(AgentKind::Gemini)
        );
        assert_eq!(
            AgentKind::from_agent_type("copilot"),
            Some(AgentKind::Copilot)
        );
        assert_eq!(
            AgentKind::from_agent_type("opencode"),
            Some(AgentKind::OpenCode)
        );
        assert_eq!(AgentKind::from_agent_type("pi"), Some(AgentKind::Pi));
    }

    #[test]
    fn agent_kind_from_agent_type_unknown_is_none() {
        assert_eq!(AgentKind::from_agent_type("aider"), None);
        assert_eq!(AgentKind::from_agent_type(""), None);
    }

    #[test]
    fn default_read_paths_only_returns_existing_paths() {
        // A fresh temp dir as "home" has none of the toolchain/rc files, so the
        // per-user candidates are filtered out. Only system roots that happen to
        // exist on the test machine may remain.
        let empty_home = tempfile::tempdir().unwrap();
        let paths = default_read_paths(empty_home.path());
        for p in &paths {
            assert!(p.exists(), "returned a non-existent path: {}", p.display());
            // None of the per-user ($HOME-relative) candidates should survive.
            assert!(
                !p.starts_with(empty_home.path()),
                "empty home should contribute no read paths, got {}",
                p.display()
            );
        }
    }

    #[test]
    fn default_read_paths_includes_existing_home_files() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join(".zshrc"), "export PATH=$PATH\n").unwrap();
        std::fs::create_dir(home.path().join(".cargo")).unwrap();

        let paths = default_read_paths(home.path());
        assert!(paths.contains(&home.path().join(".zshrc")));
        assert!(paths.contains(&home.path().join(".cargo")));
        // A candidate that doesn't exist is not included.
        assert!(!paths.contains(&home.path().join(".nvm")));
    }

    // Regression: sandboxed `cargo check` failed with "Could not read repository
    // exclude: Operation not permitted" because gix (cargo's build-script
    // fingerprinting) reads the user's global git config and excludes, both under
    // $HOME. The sandbox must grant read on `~/.gitconfig` and `~/.config/git`.
    #[test]
    fn default_read_paths_includes_global_git_config() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join(".gitconfig"), "[core]\n").unwrap();
        std::fs::create_dir_all(home.path().join(".config/git")).unwrap();

        let paths = default_read_paths(home.path());
        assert!(paths.contains(&home.path().join(".gitconfig")));
        assert!(paths.contains(&home.path().join(".config/git")));
    }
}
