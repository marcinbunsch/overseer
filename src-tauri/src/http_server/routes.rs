//! HTTP route handlers for command invocation.
//!
//! The main route is `/api/invoke/{command}` which accepts POST requests
//! with JSON body and dispatches to the appropriate command handler.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::SharedState;

/// Response format for command invocation.
#[derive(Serialize)]
pub struct InvokeResponse {
    /// Whether the command succeeded.
    pub success: bool,
    /// The result data (if successful).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Error message (if failed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Request body for command invocation.
#[derive(Deserialize)]
pub struct InvokeRequest {
    /// Arguments for the command (optional).
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Handler for POST /api/invoke/{command}
///
/// This is a placeholder that will be expanded to dispatch to actual command handlers.
/// For now, it returns information about the command and its arguments.
pub async fn invoke_handler(
    Path(command): Path<String>,
    State(_state): State<Arc<SharedState>>,
    Json(request): Json<InvokeRequest>,
) -> (StatusCode, Json<InvokeResponse>) {
    log::debug!("HTTP invoke: {} with args: {:?}", command, request.args);

    // TODO: Implement command dispatch
    // For now, return a placeholder response indicating the command was received
    match command.as_str() {
        // Placeholder: echo the command and args back
        "echo" => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!({
                    "command": command,
                    "args": request.args,
                })),
                error: None,
            }),
        ),

        // Unknown command
        _ => (
            StatusCode::NOT_FOUND,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(format!("Unknown command: {}", command)),
            }),
        ),
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invoke_response_serialization() {
        let response = InvokeResponse {
            success: true,
            data: Some(serde_json::json!({"key": "value"})),
            error: None,
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"key\":\"value\""));
        assert!(!json.contains("error"));
    }

    #[test]
    fn invoke_response_error_serialization() {
        let response = InvokeResponse {
            success: false,
            data: None,
            error: Some("Something went wrong".to_string()),
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("Something went wrong"));
        assert!(!json.contains("data"));
    }

    #[test]
    fn invoke_request_deserialization() {
        let json = r#"{"args": {"key": "value"}}"#;
        let request: InvokeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.args["key"], "value");
    }

    #[test]
    fn invoke_request_empty_args() {
        let json = r#"{}"#;
        let request: InvokeRequest = serde_json::from_str(json).unwrap();
        assert!(request.args.is_null());
    }
}
