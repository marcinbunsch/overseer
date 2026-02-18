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
use std::path::PathBuf;
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
/// Dispatches commands to the appropriate handler functions.
/// Commands that require Tauri state will be added as SharedState grows.
pub async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<Arc<SharedState>>,
    Json(request): Json<InvokeRequest>,
) -> (StatusCode, Json<InvokeResponse>) {
    log::debug!("HTTP invoke: {} with args: {:?}", command, request.args);

    match command.as_str() {
        // Git operations
        "list_workspaces" => dispatch_list_workspaces(request.args).await,
        "list_changed_files" => dispatch_list_changed_files(request.args).await,
        "is_git_repo" => dispatch_is_git_repo(request.args).await,
        "get_file_diff" => dispatch_get_file_diff(request.args).await,
        "get_uncommitted_diff" => dispatch_get_uncommitted_diff(request.args).await,

        // Persistence operations
        "load_project_registry" => dispatch_load_project_registry(&state).await,
        "save_project_registry" => dispatch_save_project_registry(&state, request.args).await,
        "load_workspace_state" => dispatch_load_workspace_state(&state, request.args).await,
        "save_workspace_state" => dispatch_save_workspace_state(&state, request.args).await,
        "load_chat_index" => dispatch_load_chat_index(&state, request.args).await,
        "save_chat_index" => dispatch_save_chat_index(&state, request.args).await,
        "load_chat" => dispatch_load_chat(&state, request.args).await,
        "list_chat_ids" => dispatch_list_chat_ids(&state, request.args).await,
        "get_config_dir" => dispatch_get_config_dir(&state).await,

        // Debug utility
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
// GIT COMMAND DISPATCHERS
// ============================================================================

async fn dispatch_list_workspaces(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
    let repo_path = match args.get("repoPath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: repoPath".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(repo_path);
    match overseer_core::git::list_workspaces(&path).await {
        Ok(workspaces) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(workspaces).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_list_changed_files(
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let workspace_path = match args.get("workspacePath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspacePath".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(workspace_path);
    match overseer_core::git::list_changed_files(&path).await {
        Ok(result) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(result).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_is_git_repo(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: path".to_string()),
                }),
            );
        }
    };

    let is_repo = overseer_core::git::is_git_repo(&PathBuf::from(path));
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(is_repo)),
            error: None,
        }),
    )
}

async fn dispatch_get_file_diff(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
    let workspace_path = match args.get("workspacePath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspacePath".to_string()),
                }),
            );
        }
    };

    let file_path = match args.get("filePath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: filePath".to_string()),
                }),
            );
        }
    };

    let file_status = match args.get("fileStatus").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: fileStatus".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(workspace_path);
    match overseer_core::git::get_file_diff(&path, file_path, file_status).await {
        Ok(diff) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(diff)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_get_uncommitted_diff(
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let workspace_path = match args.get("workspacePath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspacePath".to_string()),
                }),
            );
        }
    };

    let file_path = match args.get("filePath").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: filePath".to_string()),
                }),
            );
        }
    };

    let file_status = match args.get("fileStatus").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: fileStatus".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(workspace_path);
    match overseer_core::git::get_uncommitted_diff(&path, file_path, file_status).await {
        Ok(diff) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(diff)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

// ============================================================================
// PERSISTENCE COMMAND DISPATCHERS
// ============================================================================

async fn dispatch_load_project_registry(
    state: &SharedState,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    match overseer_core::persistence::load_project_registry(&config_dir) {
        Ok(registry) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(registry).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_save_project_registry(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let registry: overseer_core::persistence::ProjectRegistry =
        match serde_json::from_value(args.get("registry").cloned().unwrap_or_default()) {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid registry format: {}", e)),
                    }),
                );
            }
        };

    match overseer_core::persistence::save_project_registry(&config_dir, &registry) {
        Ok(()) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: None,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_load_workspace_state(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let chat_dir = match state.get_chat_dir(project_name, workspace_name) {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    match overseer_core::persistence::load_workspace_state(&chat_dir) {
        Ok(ws_state) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(ws_state).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_save_workspace_state(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let chat_dir = match state.get_chat_dir(project_name, workspace_name) {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let workspace_state: overseer_core::persistence::WorkspaceState =
        match serde_json::from_value(args.get("state").cloned().unwrap_or_default()) {
            Ok(s) => s,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid state format: {}", e)),
                    }),
                );
            }
        };

    match overseer_core::persistence::save_workspace_state(&chat_dir, &workspace_state) {
        Ok(()) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: None,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_load_chat_index(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);
    match overseer_core::persistence::load_chat_index(&chat_dir) {
        Ok(index) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(index).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_save_chat_index(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let index: overseer_core::persistence::ChatIndex =
        match serde_json::from_value(args.get("index").cloned().unwrap_or_default()) {
            Ok(i) => i,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid index format: {}", e)),
                    }),
                );
            }
        };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);
    match overseer_core::persistence::save_chat_index(&chat_dir, &index) {
        Ok(()) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: None,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_load_chat(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: chatId".to_string()),
                }),
            );
        }
    };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);
    match overseer_core::persistence::load_chat(&chat_dir, chat_id) {
        Ok(chat) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(chat).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_list_chat_ids(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let config_dir = match state.get_config_dir() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Config directory not set".to_string()),
                }),
            );
        }
    };

    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            );
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            );
        }
    };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);
    match overseer_core::persistence::list_chat_ids(&chat_dir) {
        Ok(ids) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(ids)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

async fn dispatch_get_config_dir(state: &SharedState) -> (StatusCode, Json<InvokeResponse>) {
    match state.get_config_dir() {
        Some(dir) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(dir.to_string_lossy())),
                error: None,
            }),
        ),
        None => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some("Config directory not set".to_string()),
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

    #[tokio::test]
    async fn dispatch_list_workspaces_missing_args() {
        let args = serde_json::json!({});
        let (status, Json(response)) = dispatch_list_workspaces(args).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("repoPath"));
    }

    #[tokio::test]
    async fn dispatch_is_git_repo_missing_args() {
        let args = serde_json::json!({});
        let (status, Json(response)) = dispatch_is_git_repo(args).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("path"));
    }

    #[tokio::test]
    async fn dispatch_is_git_repo_with_valid_path() {
        let args = serde_json::json!({"path": "/tmp/nonexistent"});
        let (status, Json(response)) = dispatch_is_git_repo(args).await;
        assert_eq!(status, StatusCode::OK);
        assert!(response.success);
        // Should return false for non-existent path
        assert_eq!(response.data, Some(serde_json::json!(false)));
    }

    #[tokio::test]
    async fn dispatch_get_config_dir_without_config() {
        let event_bus = Arc::new(overseer_core::EventBus::new());
        let state = SharedState::new(event_bus);
        let (status, Json(response)) = dispatch_get_config_dir(&state).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("not set"));
    }

    #[tokio::test]
    async fn dispatch_get_config_dir_with_config() {
        let event_bus = Arc::new(overseer_core::EventBus::new());
        let state = SharedState::with_config_dir(event_bus, PathBuf::from("/tmp/test"));
        let (status, Json(response)) = dispatch_get_config_dir(&state).await;
        assert_eq!(status, StatusCode::OK);
        assert!(response.success);
        assert_eq!(response.data, Some(serde_json::json!("/tmp/test")));
    }

    #[tokio::test]
    async fn dispatch_load_project_registry_without_config() {
        let event_bus = Arc::new(overseer_core::EventBus::new());
        let state = SharedState::new(event_bus);
        let (status, Json(response)) = dispatch_load_project_registry(&state).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("not set"));
    }
}
