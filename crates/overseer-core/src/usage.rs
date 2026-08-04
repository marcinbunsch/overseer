use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Keychain service for the default `~/.claude` login. Claude Code stores that
/// account's OAuth blob under this exact name (no suffix).
const DEFAULT_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

#[derive(Error, Debug)]
pub enum UsageError {
    #[error("Failed to execute command: {0}")]
    CommandError(String),
    #[error("Failed to parse response JSON: {0}")]
    JsonParseError(String),
    #[error("Usage API returned an error: {0}")]
    ApiError(String),
    #[error("Claude usage API is only supported on macOS")]
    UnsupportedPlatform,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsagePeriod {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: Option<u32>,
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeUsageResponse {
    pub five_hour: Option<UsagePeriod>,
    pub seven_day: Option<UsagePeriod>,
    pub seven_day_oauth_apps: Option<UsagePeriod>,
    pub seven_day_opus: Option<UsagePeriod>,
    pub seven_day_sonnet: Option<UsagePeriod>,
    pub seven_day_cowork: Option<UsagePeriod>,
    pub iguana_necktie: Option<UsagePeriod>,
    pub extra_usage: Option<ExtraUsage>,
}

/// Parse the raw usage API response body.
///
/// The API returns either a usage object or an error envelope like
/// `{"error": {"type": "...", "message": "..."}}`. Because every field in
/// [`ClaudeUsageResponse`] is optional, an error envelope would otherwise
/// deserialize into an all-`null` struct and silently masquerade as "no usage".
/// Detect the error envelope explicitly and surface it instead.
fn parse_usage_response(response_text: &str) -> Result<ClaudeUsageResponse, UsageError> {
    let value: serde_json::Value = serde_json::from_str(response_text)
        .map_err(|e| UsageError::JsonParseError(e.to_string()))?;

    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(UsageError::ApiError(message.to_string()));
    }

    serde_json::from_value(value).map_err(|e| UsageError::JsonParseError(e.to_string()))
}

/// Fetch Claude usage data from the API via a shell command.
///
/// `config_dir` is the chat's per-project `CLAUDE_CONFIG_DIR` override (the raw
/// user value, may start with `~`/`$HOME`; `None` = default `~/.claude`). It
/// selects which keychain entry the OAuth token is read from, so the dials
/// report the account that chat actually runs under. The token never enters
/// Overseer memory — only the (non-secret) keychain service name is computed
/// here; the token stays inside the shell pipeline.
#[cfg(target_os = "macos")]
pub async fn fetch_claude_usage(
    config_dir: Option<String>,
) -> Result<ClaudeUsageResponse, UsageError> {
    use std::process::Command;
    use tokio::task;

    let home = std::env::var("HOME").unwrap_or_default();
    let service = keychain_service_name(config_dir.as_deref(), &home);

    // Run blocking shell command in dedicated thread pool
    task::spawn_blocking(move || {
        // The keychain blob can contain multiple `accessToken` fields (e.g. an
        // `mcpOAuth` section with per-server tokens). Scope extraction to the
        // `claudeAiOauth` section first so we grab the OAuth token the usage API
        // expects, not the first token that happens to appear in the JSON.
        //
        // `service` is `Claude Code-credentials` plus, for a custom config dir, a
        // hex suffix — no quotes or shell metacharacters, so interpolating it into
        // the single-quoted `-s` argument is safe.
        let command = format!(
            r#"curl -s https://api.anthropic.com/api/oauth/usage -H "Authorization: Bearer $(security find-generic-password -s '{service}' -w | sed 's/.*"claudeAiOauth"//' | grep -o '"accessToken":"[^"]\+"' | head -n 1 | sed 's/"accessToken":"//;s/"$//')" -H "anthropic-beta: oauth-2025-04-20""#
        );

        let output = Command::new("sh")
            .arg("-c")
            .arg(&command)
            .output()
            .map_err(|e| UsageError::CommandError(e.to_string()))?;

        if !output.status.success() {
            return Err(UsageError::CommandError(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        let response_text = String::from_utf8_lossy(&output.stdout);
        parse_usage_response(&response_text)
    })
    .await
    .map_err(|e| UsageError::CommandError(format!("Task join error: {e}")))?
}

/// Non-macOS stub that returns platform error
#[cfg(not(target_os = "macos"))]
pub async fn fetch_claude_usage(
    _config_dir: Option<String>,
) -> Result<ClaudeUsageResponse, UsageError> {
    Err(UsageError::UnsupportedPlatform)
}

/// Resolve the macOS keychain service name that holds a config dir's OAuth token.
///
/// Claude Code keys the entry by config dir: the default `~/.claude` login lives
/// under the bare [`DEFAULT_KEYCHAIN_SERVICE`], and every other config dir under
/// `Claude Code-credentials-<first 8 hex of sha256(absolute dir path)>`. Verified
/// against a real keychain: `~/.claude-personal` → `...-93e6d69c`.
fn keychain_service_name(config_dir: Option<&str>, home: &str) -> String {
    let home = home.trim_end_matches('/');
    let default_dir = format!("{home}/.claude");

    let dir = match crate::paths::expand_config_dir(config_dir, home) {
        None => return DEFAULT_KEYCHAIN_SERVICE.to_string(),
        Some(dir) => dir,
    };
    let dir = dir.trim_end_matches('/');
    if dir == default_dir {
        return DEFAULT_KEYCHAIN_SERVICE.to_string();
    }

    let digest = Sha256::digest(dir.as_bytes());
    // First 4 bytes = the 8 hex chars Claude Code uses as the suffix.
    let suffix: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("{DEFAULT_KEYCHAIN_SERVICE}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usage_object() {
        let body = r#"{
            "five_hour": {"utilization": 60.0, "resets_at": "2026-07-14T11:40:00Z"},
            "seven_day": {"utilization": 18.0, "resets_at": "2026-07-17T17:00:00Z"},
            "seven_day_oauth_apps": null,
            "seven_day_opus": null,
            "seven_day_sonnet": null,
            "seven_day_cowork": null,
            "iguana_necktie": null,
            "extra_usage": {"is_enabled": true, "monthly_limit": 4250, "used_credits": null, "utilization": null}
        }"#;

        let parsed = parse_usage_response(body).expect("should parse usage object");
        let five_hour = parsed.five_hour.expect("five_hour present");
        assert_eq!(five_hour.utilization, 60.0);
        assert_eq!(five_hour.resets_at.as_deref(), Some("2026-07-14T11:40:00Z"));
        assert!(parsed.extra_usage.expect("extra_usage present").is_enabled);
    }

    #[test]
    fn surfaces_error_envelope_instead_of_null_usage() {
        // A wrong/expired token yields this shape. Previously it deserialized
        // into an all-null struct and looked like empty usage.
        let body = r#"{"error": {"type": "rate_limit_error", "message": "Rate limited. Please try again later."}}"#;

        let err = parse_usage_response(body).expect_err("error envelope should surface");
        match err {
            UsageError::ApiError(msg) => {
                assert!(msg.contains("Rate limited"), "got: {msg}")
            }
            other => panic!("expected ApiError, got {other:?}"),
        }
    }

    #[test]
    fn error_envelope_without_message_falls_back() {
        let body = r#"{"error": {"type": "some_error"}}"#;
        let err = parse_usage_response(body).expect_err("should be an error");
        assert!(matches!(err, UsageError::ApiError(_)));
    }

    #[test]
    fn ignores_unknown_forward_compatible_fields() {
        // The API adds new period keys over time (e.g. tangelo, nimbus_quill).
        // Unknown fields must not break parsing.
        let body = r#"{"five_hour": null, "tangelo": null, "nimbus_quill": {"utilization": 5.0, "resets_at": null}}"#;
        let parsed = parse_usage_response(body).expect("unknown fields ignored");
        assert!(parsed.five_hour.is_none());
    }

    #[test]
    fn invalid_json_is_a_parse_error() {
        let err = parse_usage_response("not json").expect_err("should fail");
        assert!(matches!(err, UsageError::JsonParseError(_)));
    }

    #[test]
    fn default_config_dir_uses_unsuffixed_service() {
        // None and the default `~/.claude` both map to the bare entry, so the
        // existing default-account behavior is unchanged.
        assert_eq!(
            keychain_service_name(None, "/Users/alice"),
            "Claude Code-credentials"
        );
        assert_eq!(
            keychain_service_name(Some("~/.claude"), "/Users/alice"),
            "Claude Code-credentials"
        );
        assert_eq!(
            keychain_service_name(Some("$HOME/.claude"), "/Users/alice"),
            "Claude Code-credentials"
        );
        // A trailing slash still resolves to the default.
        assert_eq!(
            keychain_service_name(Some("~/.claude/"), "/Users/alice"),
            "Claude Code-credentials"
        );
        // Blank string behaves like None.
        assert_eq!(
            keychain_service_name(Some("   "), "/Users/alice"),
            "Claude Code-credentials"
        );
    }

    #[test]
    fn custom_config_dir_uses_hashed_service() {
        // Regression vector captured from a real macOS keychain: the config dir
        // `/Users/marcinbunsch/.claude-personal` has entry
        // `Claude Code-credentials-93e6d69c` (first 8 hex of sha256 of the path).
        assert_eq!(
            keychain_service_name(Some("~/.claude-personal"), "/Users/marcinbunsch"),
            "Claude Code-credentials-93e6d69c"
        );
        // Same result whether the tilde is pre-expanded to an absolute path.
        assert_eq!(
            keychain_service_name(
                Some("/Users/marcinbunsch/.claude-personal"),
                "/Users/marcinbunsch"
            ),
            "Claude Code-credentials-93e6d69c"
        );
    }
}
