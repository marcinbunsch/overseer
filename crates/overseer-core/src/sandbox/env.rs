//! Environment allow-list for sandboxed agents.
//!
//! A sandboxed agent starts from a wiped environment (`.env_clear()`), then gets
//! back only what [`sandbox_env_allowlist`] returns: the handful of variables a
//! shell needs to function, plus the credentials the chosen agent reads from the
//! environment. Everything else on the host — other API keys, `AWS_*`,
//! `SSH_AUTH_SOCK` — is gone.

use super::AgentKind;

/// Base variables every sandboxed process keeps regardless of agent. Without
/// these a login shell can't find binaries or render output correctly.
const BASE_ENV_KEYS: &[&str] = &[
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "TMPDIR",
];

impl AgentKind {
    /// Environment variables carrying this agent's model credentials. Kept in
    /// the allow-list so the wiped environment doesn't break authentication.
    /// Claude/Codex/Copilot usually authenticate through the keychain or a
    /// config file, but honor an explicit key if the user set one.
    pub fn auth_env_keys(self) -> &'static [&'static str] {
        match self {
            AgentKind::Claude => &["ANTHROPIC_API_KEY"],
            AgentKind::Codex => &["OPENAI_API_KEY"],
            AgentKind::Copilot => &["GITHUB_TOKEN", "GH_TOKEN"],
            AgentKind::Gemini => &[
                "GEMINI_API_KEY",
                "GOOGLE_API_KEY",
                "GOOGLE_APPLICATION_CREDENTIALS",
                "GOOGLE_CLOUD_PROJECT",
                "GOOGLE_CLOUD_LOCATION",
            ],
            AgentKind::OpenCode => &[],
            AgentKind::Pi => &[],
        }
    }
}

/// The `(key, value)` pairs a sandboxed agent of `agent` keeps. Reads the
/// current process environment: base keys, any `LC_*` locale variables, and the
/// agent's auth keys — each included only if it's actually set.
pub fn sandbox_env_allowlist(agent: AgentKind) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();

    for key in BASE_ENV_KEYS {
        if let Ok(value) = std::env::var(key) {
            out.push(((*key).to_string(), value));
        }
    }

    // Locale variables (LC_ALL, LC_CTYPE, ...) affect tool output encoding.
    for (key, value) in std::env::vars() {
        if key.starts_with("LC_") {
            out.push((key, value));
        }
    }

    for key in agent.auth_env_keys() {
        if let Ok(value) = std::env::var(key) {
            out.push(((*key).to_string(), value));
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_auth_keys_include_gemini_api_key() {
        let keys = AgentKind::Gemini.auth_env_keys();
        assert!(keys.contains(&"GEMINI_API_KEY"));
        assert!(keys.contains(&"GOOGLE_APPLICATION_CREDENTIALS"));
    }

    #[test]
    fn claude_auth_keys_are_just_anthropic() {
        assert_eq!(AgentKind::Claude.auth_env_keys(), &["ANTHROPIC_API_KEY"]);
    }

    #[test]
    fn opencode_and_pi_have_no_auth_env_keys() {
        assert!(AgentKind::OpenCode.auth_env_keys().is_empty());
        assert!(AgentKind::Pi.auth_env_keys().is_empty());
    }

    #[test]
    fn allowlist_never_leaks_arbitrary_host_vars() {
        // A non-allowlisted secret set on the host must not appear in the result.
        // Using a fixed unusual name; env is process-global so keep it unique.
        std::env::set_var("OVERSEER_SANDBOX_TEST_SECRET", "should-not-leak");
        let allow = sandbox_env_allowlist(AgentKind::Claude);
        std::env::remove_var("OVERSEER_SANDBOX_TEST_SECRET");

        assert!(
            !allow
                .iter()
                .any(|(k, _)| k == "OVERSEER_SANDBOX_TEST_SECRET"),
            "arbitrary host var leaked into the sandbox env"
        );
    }

    #[test]
    fn allowlist_keeps_path_when_set() {
        // PATH is essentially always set in a test process.
        std::env::set_var("PATH", "/usr/bin:/bin");
        let allow = sandbox_env_allowlist(AgentKind::Claude);
        assert!(allow.iter().any(|(k, _)| k == "PATH"));
    }
}
