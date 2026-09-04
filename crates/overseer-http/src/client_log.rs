//! Client-side error ingest (`POST /api/client-log`).
//!
//! The browser SPA (loaded on mobile over HTTP) has no console you can open on a
//! phone. When it throws — an uncaught error, an unhandled promise rejection, or
//! a `console.error` — it POSTs the details here, and we write them into the same
//! server log stream. So a mobile blank-screen crash lands in the daemon's log
//! file where you can actually read it.
//!
//! This route sits inside the protected group in `lib.rs`, so the normal bearer
//! auth guards it like every other endpoint.

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

use crate::HttpSharedState;

/// One error report from the browser.
#[derive(Debug, Deserialize)]
pub struct ClientLogEntry {
    /// Log level: "error", "warn", "info", "log", or "debug".
    #[serde(default)]
    pub level: String,
    /// The error message (already stringified by the client).
    #[serde(default)]
    pub message: String,
    /// Page URL where it happened, if the client sent one.
    #[serde(default)]
    pub source: Option<String>,
    /// JS stack trace, if available.
    #[serde(default)]
    pub stack: Option<String>,
}

/// Handle a client error report by writing it to the server log.
///
/// Always returns 204 — the client fires this and forgets; a failure to log
/// must never break the page further. Errors and warnings go to `log::error!` /
/// `log::warn!`; everything else to `log::info!`.
pub async fn client_log_handler(
    State(_state): State<Arc<HttpSharedState>>,
    Json(entry): Json<ClientLogEntry>,
) -> impl IntoResponse {
    let line = format_client_log(&entry);
    match entry.level.as_str() {
        "error" => log::error!("{line}"),
        "warn" => log::warn!("{line}"),
        _ => log::info!("{line}"),
    }
    StatusCode::NO_CONTENT
}

/// Build the single log line for a client report. Kept separate so it can be
/// unit-tested without an HTTP round-trip.
fn format_client_log(entry: &ClientLogEntry) -> String {
    let mut line = format!("[client] {}", entry.message);
    if let Some(source) = &entry.source {
        if !source.is_empty() {
            line.push_str(&format!(" (at {source})"));
        }
    }
    if let Some(stack) = &entry.stack {
        if !stack.is_empty() {
            line.push_str(&format!("\n{stack}"));
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(level: &str, message: &str) -> ClientLogEntry {
        ClientLogEntry {
            level: level.to_string(),
            message: message.to_string(),
            source: None,
            stack: None,
        }
    }

    #[test]
    fn formats_bare_message() {
        let e = entry("error", "boom");
        assert_eq!(format_client_log(&e), "[client] boom");
    }

    #[test]
    fn appends_source_when_present() {
        let mut e = entry("error", "boom");
        e.source = Some("https://host/app".to_string());
        assert_eq!(format_client_log(&e), "[client] boom (at https://host/app)");
    }

    #[test]
    fn appends_stack_on_its_own_line() {
        let mut e = entry("error", "boom");
        e.stack = Some("at foo\nat bar".to_string());
        assert_eq!(format_client_log(&e), "[client] boom\nat foo\nat bar");
    }

    #[test]
    fn empty_source_and_stack_are_ignored() {
        let mut e = entry("warn", "hmm");
        e.source = Some(String::new());
        e.stack = Some(String::new());
        assert_eq!(format_client_log(&e), "[client] hmm");
    }

    #[tokio::test]
    async fn handler_returns_no_content() {
        let context = std::sync::Arc::new(overseer_core::OverseerContext::builder().build());
        let state = std::sync::Arc::new(crate::HttpSharedState::new(context));
        let response = client_log_handler(
            State(state),
            Json(entry("error", "something broke on mobile")),
        )
        .await;
        let response = response.into_response();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }
}
