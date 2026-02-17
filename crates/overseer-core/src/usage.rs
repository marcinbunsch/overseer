use serde::{Deserialize, Serialize};
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum UsageError {
    #[error("Failed to execute command: {0}")]
    CommandError(String),
    #[error("Failed to parse response JSON: {0}")]
    JsonParseError(String),
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
    pub monthly_limit: u32,
    pub used_credits: f64,
    pub utilization: f64,
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

/// Fetch Claude usage data from API via shell command
/// Token never enters Overseer memory - stays in shell pipeline
#[cfg(target_os = "macos")]
pub async fn fetch_claude_usage() -> Result<ClaudeUsageResponse, UsageError> {
    let command = r#"curl -s https://api.anthropic.com/api/oauth/usage \
               -H "Authorization: Bearer $(security find-generic-password -s 'Claude Code-credentials' -w | grep -o '"accessToken":"[^"]\+"' | sed 's/"accessToken":"//;s/"$//' | head -n 1)" \
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

    serde_json::from_str(&response_text).map_err(|e| UsageError::JsonParseError(e.to_string()))
}

/// Non-macOS stub that returns platform error
#[cfg(not(target_os = "macos"))]
pub async fn fetch_claude_usage() -> Result<ClaudeUsageResponse, UsageError> {
    Err(UsageError::UnsupportedPlatform)
}
