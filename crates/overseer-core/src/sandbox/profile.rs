//! Renders a Seatbelt (SBPL) profile from a [`SandboxSpec`].
//!
//! The profile is default-deny: nothing is allowed unless a rule grants it.
//! Reads are broad (system dirs, toolchains, rc files, the agent's auth path)
//! because blocking them breaks node/git/cargo; writes are tight (workspace,
//! git dir, temp only) because write-confinement plus the environment wipe is
//! the real boundary. Network stays open so the agent can reach its model API.

use super::{AgentKind, SandboxSpec};
use std::path::Path;

/// Builds SBPL text for one [`SandboxSpec`]. Pure — all IO happens when the
/// spec is constructed, so `render` is deterministic and unit-testable.
pub struct SandboxProfile<'a> {
    spec: &'a SandboxSpec,
}

impl<'a> SandboxProfile<'a> {
    pub fn from_spec(spec: &'a SandboxSpec) -> Self {
        SandboxProfile { spec }
    }

    /// Render the full SBPL profile.
    pub fn render(&self) -> String {
        let mut lines: Vec<String> = Vec::new();

        lines.push("(version 1)".to_string());
        // Apple's base profile grants the low-level operations dyld and libSystem
        // need to start any process. Without it a default-deny profile SIGABRTs
        // every binary before it runs. It does not open up file reads — a secret
        // outside the allow-list stays denied.
        lines.push(r#"(import "/System/Library/Sandbox/Profiles/bsd.sb")"#.to_string());
        // Default-deny, and don't log each denial — denials are expected here.
        lines.push("(deny default (with no-log))".to_string());

        self.push_process_basics(&mut lines);
        self.push_system_reads(&mut lines);
        self.push_extra_reads(&mut lines);
        self.push_agent_auth(&mut lines);
        self.push_workspace_writes(&mut lines);
        self.push_network(&mut lines);

        // Trailing newline keeps the file tidy.
        lines.join("\n") + "\n"
    }

    /// Syscalls any process needs to start and run: fork/exec, signal peers in
    /// the same sandbox, read sysctl/system info, and look up mach services
    /// (needed for dyld, DNS via mDNSResponder, and the keychain).
    fn push_process_basics(&self, lines: &mut Vec<String>) {
        lines.push(";; --- process basics ---".to_string());
        lines.push("(allow process-fork)".to_string());
        lines.push("(allow process-exec*)".to_string());
        lines.push("(allow signal (target same-sandbox))".to_string());
        lines.push("(allow sysctl-read)".to_string());
        lines.push("(allow mach-lookup)".to_string());
        lines.push("(allow iokit-open)".to_string());
        lines.push("(allow system-socket)".to_string());
        // Devices agents write to for stdio and randomness.
        lines.push(
            "(allow file-write* file-read* (literal \"/dev/null\") (literal \"/dev/dtracehelper\") \
             (literal \"/dev/tty\") (literal \"/dev/random\") (literal \"/dev/urandom\") \
             (subpath \"/dev/fd\"))"
                .to_string(),
        );
    }

    /// Read-only access to the system directories every CLI reads (binaries,
    /// libraries, the dyld shared cache, DNS config). Broad on purpose.
    fn push_system_reads(&self, lines: &mut Vec<String>) {
        lines.push(";; --- system reads ---".to_string());
        let system_roots = [
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/var",
            "/private/var/db/dyld",
            "/private/etc",
            "/System",
            // Apple Silicon keeps the dyld shared cache and system libraries here.
            "/System/Volumes/Preboot/Cryptexes",
            "/Library",
            "/opt",
            "/dev",
            "/Applications",
        ];
        let subpaths = system_roots
            .iter()
            .map(|p| format!("(subpath {})", sbpl_string(p)))
            .collect::<Vec<_>>()
            .join(" ");
        lines.push(format!("(allow file-read* {subpaths})"));
        // Reading process/file metadata anywhere is harmless and widely needed.
        lines.push("(allow file-read-metadata)".to_string());
    }

    /// Read-only access to toolchain caches, shell rc files, and user-configured
    /// extra paths collected in [`SandboxSpec::read_paths`].
    fn push_extra_reads(&self, lines: &mut Vec<String>) {
        if self.spec.read_paths.is_empty() {
            return;
        }
        lines.push(";; --- toolchain / rc / extra reads ---".to_string());
        for path in &self.spec.read_paths {
            lines.push(format!("(allow file-read* (subpath {}))", sbpl_path(path)));
        }
    }

    /// The agent CLI's own auth and state paths.
    ///
    /// Two kinds, deliberately separate:
    /// - **read+write**: the CLI's state directory. Claude Code creates
    ///   `~/.claude/session-env/<id>` before ANY Bash command runs and rewrites
    ///   `~/.claude.json` (which lives NEXT TO the dir, outside its subpath) —
    ///   read-only here means "EPERM: mkdir" and a dead Bash tool.
    /// - **read-only**: credentials. Claude's OAuth token is in the login
    ///   keychain: besides mach-lookup to securityd (granted above), the
    ///   Security framework must read the keychain database file under
    ///   `~/Library/Keychains` or lookups return "item not found" and Claude
    ///   reports "Not logged in". Read-only is enough — decryption still goes
    ///   through securityd and its per-item ACLs.
    ///
    /// Gemini authenticates purely through environment variables, so it needs
    /// no file hole here.
    fn push_agent_auth(&self, lines: &mut Vec<String>) {
        let home = &self.spec.home;
        let (rw_dirs, ro_dirs): (Vec<std::path::PathBuf>, Vec<std::path::PathBuf>) =
            match self.spec.agent {
                AgentKind::Claude => (
                    vec![home.join(".claude"), home.join(".config/claude")],
                    vec![home.join("Library/Keychains")],
                ),
                AgentKind::Codex => (vec![home.join(".codex")], vec![]),
                AgentKind::Copilot => (
                    vec![home.join(".config/github-copilot")],
                    vec![home.join(".config/gh")],
                ),
                AgentKind::OpenCode => (
                    vec![
                        home.join(".config/opencode"),
                        home.join(".local/share/opencode"),
                    ],
                    vec![],
                ),
                AgentKind::Pi => (vec![home.join(".config/pi"), home.join(".pi")], vec![]),
                AgentKind::Gemini => (vec![], vec![]),
            };
        if rw_dirs.is_empty() && ro_dirs.is_empty() {
            return;
        }
        lines.push(";; --- agent auth/state ---".to_string());
        for dir in &rw_dirs {
            lines.push(format!(
                "(allow file-read* file-write* (subpath {}))",
                sbpl_path(dir)
            ));
        }
        for dir in &ro_dirs {
            lines.push(format!("(allow file-read* (subpath {}))", sbpl_path(dir)));
        }
        // ~/.claude.json sits outside the ~/.claude subpath and the CLI rewrites
        // it (plus .backup/tmp variants) — cover the whole prefix with a regex.
        if self.spec.agent == AgentKind::Claude {
            lines.push(format!(
                "(allow file-read* file-write* (regex {}))",
                sbpl_regex_prefix(&home.join(".claude.json"))
            ));
        }
    }

    /// Read+write to the workspace, the shared git directory, and temp. This is
    /// the entire write surface — everything else is denied.
    fn push_workspace_writes(&self, lines: &mut Vec<String>) {
        lines.push(";; --- workspace / git / temp read+write ---".to_string());
        for path in [
            &self.spec.workspace_path,
            &self.spec.git_common_dir,
            &self.spec.tmpdir,
        ] {
            lines.push(format!(
                "(allow file-read* file-write* (subpath {}))",
                sbpl_path(path)
            ));
        }
        // fnm creates a per-shell symlink dir on every shell startup; denying it
        // breaks node for fnm users. The dir only ever holds symlinks to node
        // versions, so the write grant exposes nothing sensitive.
        lines.push(format!(
            "(allow file-read* file-write* (subpath {}))",
            sbpl_path(&self.spec.home.join(".local/state/fnm_multishells"))
        ));
        // The shared /tmp (= /private/tmp), on top of $TMPDIR: Claude Code's
        // Bash tool mkdirs its scratch under /tmp/claude-<uid> and dies with
        // EPERM otherwise. /tmp is world-writable scratch on any system, so
        // this doesn't weaken the boundary that matters (home, other repos).
        lines.push("(allow file-read* file-write* (subpath \"/private/tmp\"))".to_string());
    }

    /// Outbound network so the agent can reach its model API. The sandbox
    /// boundary is filesystem + environment, not network egress.
    fn push_network(&self, lines: &mut Vec<String>) {
        lines.push(";; --- network ---".to_string());
        lines.push("(allow network-outbound)".to_string());
        lines.push("(allow network-inbound (local ip))".to_string());
    }
}

/// Quote a path as an SBPL string literal.
fn sbpl_path(path: &Path) -> String {
    sbpl_string(&path.to_string_lossy())
}

/// Build an SBPL `(regex #"^...")` prefix pattern for a path, escaping regex
/// metacharacters so e.g. `.claude.json` matches literally (and also matches
/// suffixed variants like `.claude.json.backup`).
fn sbpl_regex_prefix(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut escaped = String::with_capacity(raw.len() + 8);
    for ch in raw.chars() {
        if r".^$*+?()[]{}|\".contains(ch) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    format!("#\"^{escaped}\"")
}

/// Quote an arbitrary string as an SBPL string literal, escaping backslashes and
/// double quotes so paths with spaces or special characters can't break out.
fn sbpl_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn spec(agent: AgentKind) -> SandboxSpec {
        SandboxSpec {
            agent,
            workspace_path: PathBuf::from("/Users/dev/overseer/workspaces/repo/narwhal"),
            git_common_dir: PathBuf::from("/Users/dev/code/repo/.git"),
            tmpdir: PathBuf::from("/private/var/folders/xy/T"),
            home: PathBuf::from("/Users/dev"),
            read_paths: vec![
                PathBuf::from("/opt/homebrew"),
                PathBuf::from("/Users/dev/.zshrc"),
            ],
        }
    }

    #[test]
    fn render_is_default_deny_on_apples_base() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.starts_with(
            "(version 1)\n(import \"/System/Library/Sandbox/Profiles/bsd.sb\")\n(deny default (with no-log))"
        ));
    }

    #[test]
    fn render_grants_workspace_and_git_read_write() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains(
            "(allow file-read* file-write* (subpath \"/Users/dev/overseer/workspaces/repo/narwhal\"))"
        ));
        assert!(
            out.contains("(allow file-read* file-write* (subpath \"/Users/dev/code/repo/.git\"))")
        );
        assert!(
            out.contains("(allow file-read* file-write* (subpath \"/private/var/folders/xy/T\"))")
        );
        // Claude Code's Bash tool mkdirs /tmp/claude-<uid>; shared /tmp is granted.
        assert!(out.contains("(allow file-read* file-write* (subpath \"/private/tmp\"))"));
    }

    #[test]
    fn render_grants_extra_reads_but_not_write() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(allow file-read* (subpath \"/opt/homebrew\"))"));
        assert!(out.contains("(allow file-read* (subpath \"/Users/dev/.zshrc\"))"));
        // Extra reads must not grant write.
        assert!(!out.contains("(allow file-read* file-write* (subpath \"/opt/homebrew\"))"));
    }

    #[test]
    fn render_allows_network() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(allow network-outbound)"));
    }

    // Regression: with ~/.claude read-only, Claude Code's Bash tool dies with
    // "EPERM: mkdir ~/.claude/session-env/<id>" before any command runs — the
    // CLI's state dir must be read+write. Same for ~/.claude.json, which sits
    // NEXT TO the dir (outside its subpath) and is rewritten with .backup/tmp
    // variants, hence the regex prefix rule.
    #[test]
    fn claude_state_dirs_are_read_write() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(allow file-read* file-write* (subpath \"/Users/dev/.claude\"))"));
        assert!(
            out.contains("(allow file-read* file-write* (subpath \"/Users/dev/.config/claude\"))")
        );
        assert!(
            out.contains("(allow file-read* file-write* (regex #\"^/Users/dev/\\.claude\\.json\"))")
        );
    }

    // Regression: sandboxed Claude reported "Not logged in · Please run /login".
    // Its OAuth token is in the login keychain, and the Security framework must
    // read the keychain DATABASE FILE — mach-lookup to securityd alone returns
    // "item not found". Read-only must suffice; never grant write there.
    #[test]
    fn claude_gets_keychain_read_but_not_write() {
        let s = spec(AgentKind::Claude);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(allow file-read* (subpath \"/Users/dev/Library/Keychains\"))"));
        assert!(!out
            .contains("(allow file-read* file-write* (subpath \"/Users/dev/Library/Keychains\"))"));
    }

    #[test]
    fn codex_gets_its_own_config_hole_not_claudes() {
        let s = spec(AgentKind::Codex);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(allow file-read* file-write* (subpath \"/Users/dev/.codex\"))"));
        assert!(!out.contains("/Users/dev/.claude"));
        assert!(!out.contains("/Users/dev/Library/Keychains"));
    }

    #[test]
    fn gemini_has_no_file_auth_hole() {
        // Gemini authenticates via env vars, so no agent-auth read section.
        let s = spec(AgentKind::Gemini);
        let out = SandboxProfile::from_spec(&s).render();
        assert!(!out.contains(";; --- agent auth ---"));
    }

    #[test]
    fn sbpl_string_escapes_quotes_and_backslashes() {
        assert_eq!(sbpl_string("plain"), "\"plain\"");
        assert_eq!(sbpl_string("a b"), "\"a b\"");
        assert_eq!(sbpl_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(sbpl_string("a\\b"), "\"a\\\\b\"");
    }

    #[test]
    fn render_quotes_paths_with_spaces() {
        let mut s = spec(AgentKind::Claude);
        s.workspace_path = PathBuf::from("/Users/dev/My Code/repo");
        let out = SandboxProfile::from_spec(&s).render();
        assert!(out.contains("(subpath \"/Users/dev/My Code/repo\")"));
    }

    /// Runs the rendered profile through the real `sandbox-exec` to prove the
    /// SBPL is valid, writes inside the workspace succeed, and reads of a secret
    /// outside are denied. macOS-only; skips if `sandbox-exec` is missing.
    #[cfg(target_os = "macos")]
    #[test]
    fn rendered_profile_enforces_read_and_write_boundary() {
        use super::super::SandboxProfileFile;
        use std::process::Command;

        if Command::new("sandbox-exec").arg("-h").output().is_err() {
            eprintln!("sandbox-exec unavailable, skipping");
            return;
        }

        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "top secret").unwrap();

        // A spec that grants only the workspace (rw). git dir and tmp point at
        // the workspace too so the test doesn't depend on machine paths.
        let s = SandboxSpec {
            agent: AgentKind::Claude,
            workspace_path: std::fs::canonicalize(workspace.path()).unwrap(),
            git_common_dir: std::fs::canonicalize(workspace.path()).unwrap(),
            tmpdir: std::fs::canonicalize(workspace.path()).unwrap(),
            home: PathBuf::from("/Users/nobody"),
            read_paths: vec![],
        };
        let profile = SandboxProfile::from_spec(&s).render();
        let guard = SandboxProfileFile::write(&profile).unwrap();

        // Write inside the workspace: allowed.
        let inside = std::fs::canonicalize(workspace.path())
            .unwrap()
            .join("out.txt");
        let write_inside = Command::new("sandbox-exec")
            .args(["-f", guard.path().to_str().unwrap(), "--"])
            .args(["/usr/bin/touch", inside.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(
            write_inside.status.success(),
            "writing inside the workspace should be allowed. stderr: {}\nprofile:\n{}",
            String::from_utf8_lossy(&write_inside.stderr),
            profile
        );

        // Read the secret outside the workspace: denied (non-zero exit).
        let read_secret = Command::new("sandbox-exec")
            .args(["-f", guard.path().to_str().unwrap(), "--"])
            .args([
                "/bin/cat",
                std::fs::canonicalize(&secret).unwrap().to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(
            !read_secret.status.success(),
            "reading a secret outside the workspace should be denied"
        );
    }
}
