use serde::{Deserialize, Serialize};
use thiserror::Error;

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

/// Fetch Claude usage data from API via shell command
/// Token never enters Overseer memory - stays in shell pipeline
#[cfg(target_os = "macos")]
pub async fn fetch_claude_usage() -> Result<ClaudeUsageResponse, UsageError> {
    use std::process::Command;
    use tokio::task;

    // Run blocking shell command in dedicated thread pool
    task::spawn_blocking(|| {
        // The keychain blob can contain multiple `accessToken` fields (e.g. an
        // `mcpOAuth` section with per-server tokens). Scope extraction to the
        // `claudeAiOauth` section first so we grab the OAuth token the usage API
        // expects, not the first token that happens to appear in the JSON.
        let command = r#"curl -s https://api.anthropic.com/api/oauth/usage \
               -H "Authorization: Bearer $(security find-generic-password -s 'Claude Code-credentials' -w | sed 's/.*"claudeAiOauth"//' | grep -o '"accessToken":"[^"]\+"' | head -n 1 | sed 's/"accessToken":"//;s/"$//')" \
               -H "anthropic-beta: oauth-2025-04-20""#;

        let output = Command::new("sh")
            .arg("-c")
            .arg(command)
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
pub async fn fetch_claude_usage() -> Result<ClaudeUsageResponse, UsageError> {
    Err(UsageError::UnsupportedPlatform)
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
}
