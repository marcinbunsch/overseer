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
pub async fn invoke_handler(
    Path(command): Path<String>,
    State(state): State<Arc<SharedState>>,
    Json(request): Json<InvokeRequest>,
) -> (StatusCode, Json<InvokeResponse>) {
    log::debug!("HTTP invoke: {} with args: {:?}", command, request.args);

    match command.as_str() {
        // =====================================================================
        // GIT OPERATIONS
        // =====================================================================
        "list_workspaces" => dispatch_list_workspaces(request.args).await,
        "list_changed_files" => dispatch_list_changed_files(request.args).await,
        "is_git_repo" => dispatch_is_git_repo(request.args).await,
        "get_file_diff" => dispatch_get_file_diff(request.args).await,
        "get_uncommitted_diff" => dispatch_get_uncommitted_diff(request.args).await,
        "add_workspace" => dispatch_add_workspace(request.args).await,
        "archive_workspace" => dispatch_archive_workspace(request.args).await,
        "check_merge" => dispatch_check_merge(request.args).await,
        "merge_into_main" => dispatch_merge_into_main(request.args).await,
        "rename_branch" => dispatch_rename_branch(request.args).await,
        "delete_branch" => dispatch_delete_branch(request.args).await,
        "list_files" => dispatch_list_files(request.args).await,
        "get_pr_status" => dispatch_get_pr_status(request.args).await,

        // =====================================================================
        // PERSISTENCE OPERATIONS
        // =====================================================================
        "load_project_registry" => dispatch_load_project_registry(&state).await,
        "save_project_registry" => dispatch_save_project_registry(&state, request.args).await,
        "upsert_project" => dispatch_upsert_project(&state, request.args).await,
        "remove_project" => dispatch_remove_project(&state, request.args).await,
        "load_workspace_state" => dispatch_load_workspace_state(&state, request.args).await,
        "save_workspace_state" => dispatch_save_workspace_state(&state, request.args).await,
        "load_chat_index" => dispatch_load_chat_index(&state, request.args).await,
        "save_chat_index" => dispatch_save_chat_index(&state, request.args).await,
        "upsert_chat_entry" => dispatch_upsert_chat_entry(&state, request.args).await,
        "remove_chat_entry" => dispatch_remove_chat_entry(&state, request.args).await,
        "load_chat" => dispatch_load_chat(&state, request.args).await,
        "save_chat" => dispatch_save_chat(&state, request.args).await,
        "delete_chat" => dispatch_delete_chat(&state, request.args).await,
        "list_chat_ids" => dispatch_list_chat_ids(&state, request.args).await,
        "migrate_chat_if_needed" => dispatch_migrate_chat_if_needed(&state, request.args).await,
        "get_config_dir" => dispatch_get_config_dir(&state).await,
        "save_json_config" => dispatch_save_json_config(&state, request.args).await,
        "load_json_config" => dispatch_load_json_config(&state, request.args).await,
        "config_file_exists" => dispatch_config_file_exists(&state, request.args).await,
        "archive_chat_dir" => dispatch_archive_chat_dir(&state, request.args).await,
        "ensure_chat_dir" => dispatch_ensure_chat_dir(&state, request.args).await,
        "remove_chat_file" => dispatch_remove_chat_file(&state, request.args).await,

        // =====================================================================
        // APPROVALS
        // =====================================================================
        "load_project_approvals" => dispatch_load_project_approvals(&state, request.args).await,
        "add_approval" => dispatch_add_approval(&state, request.args).await,
        "remove_approval" => dispatch_remove_approval(&state, request.args).await,
        "clear_project_approvals" => dispatch_clear_project_approvals(&state, request.args).await,

        // =====================================================================
        // CHAT SESSION
        // =====================================================================
        "register_chat_session" => dispatch_register_chat_session(&state, request.args).await,
        "unregister_chat_session" => dispatch_unregister_chat_session(&state, request.args).await,
        "append_chat_event" => dispatch_append_chat_event(&state, request.args).await,
        "load_chat_events" => dispatch_load_chat_events(&state, request.args).await,
        "load_chat_events_with_seq" => {
            dispatch_load_chat_events_with_seq(&state, request.args).await
        }
        "load_chat_events_since_seq" => {
            dispatch_load_chat_events_since_seq(&state, request.args).await
        }
        "load_chat_metadata" => dispatch_load_chat_metadata(&state, request.args).await,
        "save_chat_metadata" => dispatch_save_chat_metadata(&state, request.args).await,
        "add_user_message" => dispatch_add_user_message(&state, request.args).await,

        // =====================================================================
        // AGENTS (Claude)
        // =====================================================================
        "stop_agent" => dispatch_stop_agent(&state, request.args).await,
        "agent_stdin" => dispatch_agent_stdin(&state, request.args).await,
        "list_running" => dispatch_list_running(&state).await,

        "send_message" => dispatch_send_message(&state, request.args).await,

        // =====================================================================
        // AGENTS (Codex, Copilot, Gemini, OpenCode) - Not yet implemented
        // =====================================================================
        "start_codex_server" | "stop_codex_server" | "codex_stdin" |
        "start_copilot_server" | "stop_copilot_server" | "copilot_stdin" |
        "start_gemini_server" | "stop_gemini_server" | "gemini_stdin" |
        "start_opencode_server" | "stop_opencode_server" | "get_opencode_port" |
        "get_opencode_password" | "opencode_get_models" | "opencode_list_models" |
        "opencode_subscribe_events" | "opencode_unsubscribe_events" => {
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(format!(
                        "Command '{}' is not yet available via HTTP. \
                        Other agent backends need similar refactoring to Claude.",
                        command
                    )),
                }),
            )
        }

        // =====================================================================
        // PTY
        // =====================================================================
        // PTY commands require native process management
        "pty_spawn" | "pty_write" | "pty_resize" | "pty_kill" => {
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(format!(
                        "Command '{}' requires native PTY management and is not available via HTTP. \
                        Terminal commands must be run from the Tauri desktop client.",
                        command
                    )),
                }),
            )
        }

        // =====================================================================
        // UTILITIES
        // =====================================================================
        "is_debug_mode" => dispatch_is_debug_mode().await,
        "is_demo_mode" => dispatch_is_demo_mode().await,
        "get_home_dir" => dispatch_get_home_dir().await,
        "check_command_exists" => dispatch_check_command_exists(request.args).await,
        "extract_overseer_blocks_cmd" => dispatch_extract_overseer_blocks(request.args).await,

        // open_external, show_main_window require native window management
        "open_external" | "show_main_window" => {
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(format!(
                        "Command '{}' requires native window management and is not available via HTTP.",
                        command
                    )),
                }),
            )
        }

        // fetch_claude_usage is an async network call that works fine via HTTP
        "fetch_claude_usage" => dispatch_fetch_claude_usage().await,

        // HTTP server commands (these wouldn't make sense via HTTP)
        "start_http_server" | "stop_http_server" | "get_http_server_status" => {
            (
                StatusCode::NOT_IMPLEMENTED,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(format!(
                        "Command '{}' manages the HTTP server itself and cannot be called via HTTP.",
                        command
                    )),
                }),
            )
        }

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

async fn dispatch_get_pr_status(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
    let workspace_path = match args.get("workspacePath").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
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

    let branch = match args.get("branch").and_then(|v| v.as_str()) {
        Some(b) => b.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: branch".to_string()),
                }),
            );
        }
    };

    let agent_shell = args
        .get("agentShell")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    match crate::git::get_pr_status(workspace_path, branch, agent_shell).await {
        Ok(status) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(status)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_add_workspace(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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

    let branch = match args.get("branch").and_then(|v| v.as_str()) {
        Some(b) => b,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: branch".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(repo_path);
    match overseer_core::git::add_workspace(&path, branch).await {
        Ok(workspace_path) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(workspace_path.to_string_lossy())),
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

async fn dispatch_archive_workspace(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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

    let repo = PathBuf::from(repo_path);
    let workspace = PathBuf::from(workspace_path);
    match overseer_core::git::archive_workspace(&repo, &workspace).await {
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

async fn dispatch_check_merge(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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
    match overseer_core::git::check_merge(&path).await {
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

async fn dispatch_merge_into_main(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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
    match overseer_core::git::merge_into_main(&path).await {
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

async fn dispatch_rename_branch(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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

    let new_name = match args.get("newName").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: newName".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(workspace_path);
    match overseer_core::git::rename_branch(&path, new_name).await {
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

async fn dispatch_delete_branch(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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

    let branch_name = match args.get("branchName").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: branchName".to_string()),
                }),
            );
        }
    };

    let path = PathBuf::from(repo_path);
    match overseer_core::git::delete_branch(&path, branch_name).await {
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

async fn dispatch_list_files(args: serde_json::Value) -> (StatusCode, Json<InvokeResponse>) {
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

    // Use blocking task since the ignore crate is sync
    let workspace_path = workspace_path.to_string();
    let result = tokio::task::spawn_blocking(move || {
        use ignore::WalkBuilder;
        use std::path::Path;

        let mut files = Vec::new();
        let root = Path::new(&workspace_path);

        let walker = WalkBuilder::new(&workspace_path)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        for entry in walker {
            match entry {
                Ok(e) => {
                    if e.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                        if let Ok(rel) = e.path().strip_prefix(root) {
                            files.push(rel.to_string_lossy().to_string());
                        }
                    }
                }
                Err(_) => continue,
            }
        }

        files.sort();
        files
    })
    .await;

    match result {
        Ok(files) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(files)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(format!("Task join error: {}", e)),
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

async fn dispatch_upsert_project(
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

    let project: overseer_core::persistence::Project =
        match serde_json::from_value(args.get("project").cloned().unwrap_or_default()) {
            Ok(p) => p,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid project format: {}", e)),
                    }),
                );
            }
        };

    let mut registry = match overseer_core::persistence::load_project_registry(&config_dir) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    overseer_core::persistence::upsert_project(&mut registry, project);

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

async fn dispatch_remove_project(
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

    let project_id = match args.get("projectId").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectId".to_string()),
                }),
            );
        }
    };

    let mut registry = match overseer_core::persistence::load_project_registry(&config_dir) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    overseer_core::persistence::remove_project(&mut registry, project_id);

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
        match serde_json::from_value(args.get("workspaceState").cloned().unwrap_or_default()) {
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

async fn dispatch_upsert_chat_entry(
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

    let entry: overseer_core::persistence::ChatIndexEntry =
        match serde_json::from_value(args.get("entry").cloned().unwrap_or_default()) {
            Ok(e) => e,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid entry format: {}", e)),
                    }),
                );
            }
        };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);

    let mut index = match overseer_core::persistence::load_chat_index(&chat_dir) {
        Ok(i) => i,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    overseer_core::persistence::upsert_chat_entry(&mut index, entry);

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

async fn dispatch_remove_chat_entry(
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
        Some(c) => c,
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

    let mut index = match overseer_core::persistence::load_chat_index(&chat_dir) {
        Ok(i) => i,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    overseer_core::persistence::remove_chat_entry(&mut index, chat_id);

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

async fn dispatch_save_chat(
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

    let chat: overseer_core::persistence::ChatFile =
        match serde_json::from_value(args.get("chat").cloned().unwrap_or_default()) {
            Ok(c) => c,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid chat format: {}", e)),
                    }),
                );
            }
        };

    let chat_dir = config_dir
        .join("chats")
        .join(project_name)
        .join(workspace_name);
    match overseer_core::persistence::save_chat(&chat_dir, &chat) {
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

async fn dispatch_delete_chat(
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
        Some(c) => c,
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
    match overseer_core::persistence::delete_chat(&chat_dir, chat_id) {
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

async fn dispatch_migrate_chat_if_needed(
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
        Some(c) => c,
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
    match overseer_core::persistence::migrate_chat_if_needed(&chat_dir, chat_id) {
        Ok(migrated) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(migrated)),
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

async fn dispatch_save_json_config(
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

    let filename = match args.get("filename").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: filename".to_string()),
                }),
            );
        }
    };

    let content = match args.get("content") {
        Some(c) => c.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: content".to_string()),
                }),
            );
        }
    };

    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    let file_path = config_dir.join(filename);
    let temp_path = config_dir.join(format!("{}.tmp", filename));

    let json = match serde_json::to_string_pretty(&content) {
        Ok(j) => j,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    if let Err(e) = std::fs::write(&temp_path, format!("{}\n", json)) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    if let Err(e) = std::fs::rename(&temp_path, &file_path) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: None,
            error: None,
        }),
    )
}

async fn dispatch_load_json_config(
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

    let filename = match args.get("filename").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: filename".to_string()),
                }),
            );
        }
    };

    let file_path = config_dir.join(filename);

    if !file_path.exists() {
        return (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::Value::Null),
                error: None,
            }),
        );
    }

    let contents = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    };

    match serde_json::from_str::<serde_json::Value>(&contents) {
        Ok(value) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(value),
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

async fn dispatch_config_file_exists(
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

    let filename = match args.get("filename").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: filename".to_string()),
                }),
            );
        }
    };

    let exists = config_dir.join(filename).exists();
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(exists)),
            error: None,
        }),
    )
}

async fn dispatch_archive_chat_dir(
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

    let archive_name = match args.get("archiveName").and_then(|v| v.as_str()) {
        Some(a) => a,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: archiveName".to_string()),
                }),
            );
        }
    };

    let chats_dir = config_dir.join("chats").join(project_name);
    let source = chats_dir.join(workspace_name);
    let archive_parent = chats_dir.join("archived");
    let dest = archive_parent.join(archive_name);

    if !source.exists() {
        return (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: None,
                error: None,
            }),
        );
    }

    if let Err(e) = std::fs::create_dir_all(&archive_parent) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    if let Err(e) = std::fs::rename(&source, &dest) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: None,
            error: None,
        }),
    )
}

async fn dispatch_ensure_chat_dir(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_dir = match get_chat_dir_from_args(state, &args) {
        Ok(dir) => dir,
        Err(response) => return response,
    };

    if let Err(e) = std::fs::create_dir_all(&chat_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e.to_string()),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: None,
            error: None,
        }),
    )
}

async fn dispatch_remove_chat_file(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_dir = match get_chat_dir_from_args(state, &args) {
        Ok(dir) => dir,
        Err(response) => return response,
    };

    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(c) => c,
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

    let file_path = chat_dir.join(format!("{}.json", chat_id));

    if file_path.exists() {
        if let Err(e) = std::fs::remove_file(&file_path) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some(e.to_string()),
                }),
            );
        }
    }

    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: None,
            error: None,
        }),
    )
}

// Helper function to extract chat_dir from args
fn get_chat_dir_from_args(
    state: &SharedState,
    args: &serde_json::Value,
) -> Result<PathBuf, (StatusCode, Json<InvokeResponse>)> {
    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: projectName".to_string()),
                }),
            ));
        }
    };

    let workspace_name = match args.get("workspaceName").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workspaceName".to_string()),
                }),
            ));
        }
    };

    match state.get_chat_dir(project_name, workspace_name) {
        Some(dir) => Ok(dir),
        None => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some("Config directory not set".to_string()),
            }),
        )),
    }
}

// ============================================================================
// APPROVALS COMMAND DISPATCHERS
// ============================================================================

async fn dispatch_load_project_approvals(
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

    let data = state.context.approval_manager.load_approvals(project_name);
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::to_value(data).unwrap_or_default()),
            error: None,
        }),
    )
}

async fn dispatch_add_approval(
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

    let tool_or_prefix = match args.get("toolOrPrefix").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: toolOrPrefix".to_string()),
                }),
            );
        }
    };

    let is_prefix = args.get("isPrefix").and_then(|v| v.as_bool()).unwrap_or(false);

    match state.context.approval_manager.add_approval(project_name, tool_or_prefix, is_prefix) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_remove_approval(
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

    let tool_or_prefix = match args.get("toolOrPrefix").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: toolOrPrefix".to_string()),
                }),
            );
        }
    };

    let is_prefix = args.get("isPrefix").and_then(|v| v.as_bool()).unwrap_or(false);

    match state.context.approval_manager.remove_approval(project_name, tool_or_prefix, is_prefix) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_clear_project_approvals(
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

    match state.context.approval_manager.clear_approvals(project_name) {
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
                error: Some(e),
            }),
        ),
    }
}

// ============================================================================
// CHAT SESSION COMMAND DISPATCHERS
// ============================================================================

async fn dispatch_register_chat_session(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
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

    let project_name = match args.get("projectName").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
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
        Some(w) => w.to_string(),
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

    let metadata: overseer_core::persistence::types::ChatMetadata =
        match serde_json::from_value(args.get("metadata").cloned().unwrap_or_default()) {
            Ok(m) => m,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid metadata format: {}", e)),
                    }),
                );
            }
        };

    match state.context.chat_sessions.register_session(chat_id, project_name, workspace_name, metadata) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_unregister_chat_session(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(c) => c,
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

    match state.context.chat_sessions.unregister_session(chat_id) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_append_chat_event(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(c) => c,
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

    let event: overseer_core::agents::event::AgentEvent =
        match serde_json::from_value(args.get("event").cloned().unwrap_or_default()) {
            Ok(e) => e,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid event format: {}", e)),
                    }),
                );
            }
        };

    match state.context.chat_sessions.append_event(chat_id, event) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_load_chat_events(
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
        Some(w) => w,
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
        Some(c) => c,
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

    match state.context.chat_sessions.load_events(project_name, workspace_name, chat_id) {
        Ok(events) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(events).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_load_chat_events_with_seq(
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
        Some(w) => w,
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
        Some(c) => c,
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

    match state
        .context
        .chat_sessions
        .load_events_with_seq(project_name, workspace_name, chat_id)
    {
        Ok(events) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(events).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_load_chat_events_since_seq(
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
        Some(w) => w,
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
        Some(c) => c,
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

    let since_seq = match args.get("sinceSeq").and_then(|v| v.as_u64()) {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: sinceSeq".to_string()),
                }),
            );
        }
    };

    match state
        .context
        .chat_sessions
        .load_events_since_seq(project_name, workspace_name, chat_id, since_seq)
    {
        Ok(events) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(events).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_load_chat_metadata(
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
        Some(w) => w,
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
        Some(c) => c,
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

    match state.context.chat_sessions.load_metadata(project_name, workspace_name, chat_id) {
        Ok(metadata) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(metadata).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_save_chat_metadata(
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
        Some(w) => w,
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

    let metadata: overseer_core::persistence::types::ChatMetadata =
        match serde_json::from_value(args.get("metadata").cloned().unwrap_or_default()) {
            Ok(m) => m,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvokeResponse {
                        success: false,
                        data: None,
                        error: Some(format!("Invalid metadata format: {}", e)),
                    }),
                );
            }
        };

    match state.context.chat_sessions.save_metadata(project_name, workspace_name, metadata) {
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
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_add_user_message(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let chat_id = match args.get("chatId").and_then(|v| v.as_str()) {
        Some(c) => c,
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

    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: content".to_string()),
                }),
            );
        }
    };

    let meta = args.get("meta").cloned();

    match state.context.chat_sessions.add_user_message(chat_id, content, meta) {
        Ok(event) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(event).unwrap_or_default()),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

// ============================================================================
// UTILITY COMMAND DISPATCHERS
// ============================================================================

async fn dispatch_is_debug_mode() -> (StatusCode, Json<InvokeResponse>) {
    let is_debug = std::env::var("OVERSEER_DEBUG").is_ok();
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(is_debug)),
            error: None,
        }),
    )
}

async fn dispatch_is_demo_mode() -> (StatusCode, Json<InvokeResponse>) {
    let is_demo = std::env::var("OVERSEER_DEMO").is_ok();
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(is_demo)),
            error: None,
        }),
    )
}

async fn dispatch_get_home_dir() -> (StatusCode, Json<InvokeResponse>) {
    match overseer_core::paths::get_home_dir() {
        Ok(home) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(home)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_check_command_exists(
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let command = match args.get("command").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: command".to_string()),
                }),
            );
        }
    };

    // Run command check in a blocking task
    let result = tokio::task::spawn_blocking(move || {
        let run_command = |args: Vec<String>| -> Result<std::process::Output, String> {
            let mut cmd = match overseer_core::shell::build_login_shell_command(&command, &args, None, None) {
                Ok(c) => c,
                Err(e) => return Err(e),
            };
            cmd.output()
                .map_err(|e| format!("Failed to run '{}': {}", command, e))
        };

        match run_command(vec!["--version".to_string()]) {
            Ok(output) => {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let version = stdout.lines().next().map(|s| s.trim().to_string());
                    serde_json::json!({
                        "available": true,
                        "version": version,
                        "error": null
                    })
                } else {
                    match run_command(vec![]) {
                        Ok(result) if result.status.success() => serde_json::json!({
                            "available": true,
                            "version": null,
                            "error": null
                        }),
                        Ok(result) => {
                            let stderr = String::from_utf8_lossy(&result.stderr);
                            serde_json::json!({
                                "available": false,
                                "version": null,
                                "error": stderr.trim().to_string()
                            })
                        }
                        Err(e) => serde_json::json!({
                            "available": false,
                            "version": null,
                            "error": e
                        }),
                    }
                }
            }
            Err(e) => serde_json::json!({
                "available": false,
                "version": null,
                "error": e
            }),
        }
    })
    .await;

    match result {
        Ok(data) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(data),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(format!("Task join error: {}", e)),
            }),
        ),
    }
}

async fn dispatch_extract_overseer_blocks(
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: content".to_string()),
                }),
            );
        }
    };

    let (clean_content, actions) = overseer_core::overseer_actions::extract_overseer_blocks(content);

    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!({
                "cleanContent": clean_content,
                "actions": actions,
            })),
            error: None,
        }),
    )
}

async fn dispatch_fetch_claude_usage() -> (StatusCode, Json<InvokeResponse>) {
    match overseer_core::usage::fetch_claude_usage().await {
        Ok(usage) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::to_value(usage).unwrap_or_default()),
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
// AGENT COMMAND DISPATCHERS (Claude)
// ============================================================================

async fn dispatch_stop_agent(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let conversation_id = match args.get("conversationId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: conversationId".to_string()),
                }),
            );
        }
    };

    state.context.claude_agents.stop(conversation_id);
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(null)),
            error: None,
        }),
    )
}

async fn dispatch_agent_stdin(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    let conversation_id = match args.get("conversationId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: conversationId".to_string()),
                }),
            );
        }
    };

    let data = match args.get("data").and_then(|v| v.as_str()) {
        Some(d) => d,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: data".to_string()),
                }),
            );
        }
    };

    match state.context.claude_agents.write_stdin(conversation_id, data) {
        Ok(()) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(null)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
            }),
        ),
    }
}

async fn dispatch_list_running(state: &SharedState) -> (StatusCode, Json<InvokeResponse>) {
    let running = state.context.claude_agents.list_running();
    (
        StatusCode::OK,
        Json(InvokeResponse {
            success: true,
            data: Some(serde_json::json!(running)),
            error: None,
        }),
    )
}

async fn dispatch_send_message(
    state: &SharedState,
    args: serde_json::Value,
) -> (StatusCode, Json<InvokeResponse>) {
    // Extract required arguments
    let conversation_id = match args.get("conversationId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: conversationId".to_string()),
                }),
            );
        }
    };

    let prompt = match args.get("prompt").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: prompt".to_string()),
                }),
            );
        }
    };

    let working_dir = match args.get("workingDir").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: workingDir".to_string()),
                }),
            );
        }
    };

    let agent_path = match args.get("agentPath").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(InvokeResponse {
                    success: false,
                    data: None,
                    error: Some("Missing required argument: agentPath".to_string()),
                }),
            );
        }
    };

    // Extract optional arguments
    let project_name = args
        .get("projectName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let session_id = args
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let model_version = args
        .get("modelVersion")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let log_dir = args
        .get("logDir")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let log_id = args
        .get("logId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let permission_mode = args
        .get("permissionMode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let agent_shell = args
        .get("agentShell")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let config = overseer_core::managers::ClaudeStartConfig {
        conversation_id,
        project_name,
        prompt,
        working_dir,
        agent_path,
        session_id,
        model_version,
        log_dir,
        log_id,
        permission_mode,
        agent_shell,
    };

    // Events will flow through EventBus -> WebSocket automatically
    match state.context.claude_agents.send_message(
        config,
        std::sync::Arc::clone(&state.context.event_bus),
        std::sync::Arc::clone(&state.context.approval_manager),
        std::sync::Arc::clone(&state.context.chat_sessions),
    ) {
        Ok(()) => (
            StatusCode::OK,
            Json(InvokeResponse {
                success: true,
                data: Some(serde_json::json!(null)),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(InvokeResponse {
                success: false,
                data: None,
                error: Some(e),
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
        let context = Arc::new(overseer_core::OverseerContext::builder().build());
        let state = SharedState::new(context);
        let (status, Json(response)) = dispatch_get_config_dir(&state).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("not set"));
    }

    #[tokio::test]
    async fn dispatch_get_config_dir_with_config() {
        let state = SharedState::with_config_dir(PathBuf::from("/tmp/test"));
        let (status, Json(response)) = dispatch_get_config_dir(&state).await;
        assert_eq!(status, StatusCode::OK);
        assert!(response.success);
        assert_eq!(response.data, Some(serde_json::json!("/tmp/test")));
    }

    #[tokio::test]
    async fn dispatch_load_project_registry_without_config() {
        let context = Arc::new(overseer_core::OverseerContext::builder().build());
        let state = SharedState::new(context);
        let (status, Json(response)) = dispatch_load_project_registry(&state).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!response.success);
        assert!(response.error.as_ref().unwrap().contains("not set"));
    }
}
