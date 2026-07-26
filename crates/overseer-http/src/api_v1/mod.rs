//! High-level driving API (`/api/v1/*`).
//!
//! This is a small, opinionated layer on top of the raw `/api/invoke/{command}`
//! RPC. It lets an external agent *drive* Overseer with plain verbs — create a
//! workspace, start a session, send a message, read the replies — instead of
//! orchestrating a handful of low-level commands and reassembling the raw event
//! stream itself.
//!
//! Everything is stored in Overseer's normal on-disk format, so a session created
//! and driven through this API opens in the desktop app like any other.
//!
//! - [`workspaces`] — list projects, create a workspace.
//! - [`sessions`] — start a session, read session status.
//! - [`messages`] — send a message (async), read messages with a poll cursor.
//! - [`views`] — fold the persisted event stream into clean messages.

mod attachments;
mod messages;
mod sessions;
mod views;
mod workspaces;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::Serialize;

use overseer_core::persistence::load_project_registry;

use crate::HttpSharedState;

/// Build the `/api/v1` router. State is applied by the caller (`start` in
/// `lib.rs`), so these routes share the same auth + CORS layers as the rest of
/// the server.
pub fn router() -> Router<Arc<HttpSharedState>> {
    Router::new()
        .route("/api/v1/projects", get(workspaces::list_projects))
        .route(
            "/api/v1/projects/{projectId}/workspaces",
            post(workspaces::create_workspace),
        )
        .route(
            "/api/v1/workspaces/{workspaceId}/sessions",
            post(sessions::create_session),
        )
        .route("/api/v1/sessions/{sessionId}", get(sessions::get_session))
        .route(
            "/api/v1/sessions/{sessionId}/messages",
            post(messages::send_message).get(messages::read_messages),
        )
        .route(
            "/api/v1/sessions/{sessionId}/attachments",
            // Raise the body limit above axum's 2 MiB default for file uploads.
            post(attachments::upload_attachment)
                .layer(DefaultBodyLimit::max(attachments::MAX_ATTACHMENT_BYTES)),
        )
}

// ============================================================================
// RESPONSE ENVELOPE
// ============================================================================

/// Uniform success/error envelope, matching the shape used by `/api/invoke`.
#[derive(Serialize)]
pub(crate) struct ApiEnvelope<T> {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl<T: Serialize> ApiEnvelope<T> {
    /// Wrap a successful payload.
    pub(crate) fn ok(data: T) -> Json<ApiEnvelope<T>> {
        Json(ApiEnvelope {
            success: true,
            data: Some(data),
            error: None,
        })
    }
}

/// An error with an HTTP status. Renders as `{ success: false, error }`.
#[derive(Debug)]
pub(crate) struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body: ApiEnvelope<()> = ApiEnvelope {
            success: false,
            data: None,
            error: Some(self.message),
        };
        (self.status, Json(body)).into_response()
    }
}

// ============================================================================
// SESSION / WORKSPACE RESOLUTION
// ============================================================================

/// Where a workspace lives on disk. The chat store keys files by project name and
/// workspace directory name (the animal folder), while the agent runs in the
/// worktree's absolute path.
pub(crate) struct WorkspaceLocation {
    /// Project name (e.g. "overseer"); the first chat-path segment.
    pub project_name: String,
    /// Workspace directory name (e.g. "dugong"); the second chat-path segment.
    pub workspace_name: String,
    /// Absolute worktree path — the agent's working directory.
    pub working_dir: String,
}

/// A resolved session: its location plus the owning workspace id.
pub(crate) struct SessionLocation {
    pub location: WorkspaceLocation,
    pub workspace_id: String,
}

/// Resolve a workspace id to its on-disk location via the project registry.
pub(crate) fn resolve_workspace(
    state: &HttpSharedState,
    workspace_id: &str,
) -> Result<WorkspaceLocation, ApiError> {
    let config_dir = state
        .get_config_dir()
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;
    let registry =
        load_project_registry(&config_dir).map_err(|e| ApiError::internal(e.to_string()))?;

    for project in &registry.projects {
        for workspace in project.get_workspaces() {
            if workspace.id == workspace_id {
                return Ok(WorkspaceLocation {
                    project_name: project.name.clone(),
                    workspace_name: workspace_name_from_path(&workspace.path),
                    working_dir: workspace.path.clone(),
                });
            }
        }
    }

    Err(ApiError::not_found(format!(
        "Workspace not found: {workspace_id}"
    )))
}

/// Resolve a session id (chat id) to its location.
///
/// The driver holds only the session id, but the on-disk layout is keyed by
/// project/workspace. We walk the registry's workspaces and pick the one whose
/// chat directory holds this session's `{id}.meta.json`. Stateless — survives a
/// server restart.
pub(crate) fn resolve_session(
    state: &HttpSharedState,
    session_id: &str,
) -> Result<SessionLocation, ApiError> {
    let config_dir = state
        .get_config_dir()
        .ok_or_else(|| ApiError::internal("Config directory not set"))?;
    let registry =
        load_project_registry(&config_dir).map_err(|e| ApiError::internal(e.to_string()))?;
    let chats_root = config_dir.join("chats");

    for project in &registry.projects {
        for workspace in project.get_workspaces() {
            let workspace_name = workspace_name_from_path(&workspace.path);
            let meta_path = chats_root
                .join(&project.name)
                .join(&workspace_name)
                .join(format!("{session_id}.meta.json"));
            if meta_path.exists() {
                return Ok(SessionLocation {
                    location: WorkspaceLocation {
                        project_name: project.name.clone(),
                        workspace_name,
                        working_dir: workspace.path.clone(),
                    },
                    workspace_id: workspace.id.clone(),
                });
            }
        }
    }

    Err(ApiError::not_found(format!(
        "Session not found: {session_id}"
    )))
}

/// The workspace directory name is the last path segment of the worktree path
/// (the animal folder the chat store writes under).
fn workspace_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

// ============================================================================
// TESTS
// ============================================================================
//
// These cover the new HTTP layer's own logic — resolution, session creation,
// and message reading/folding — by calling the handlers directly. The git
// worktree call in `create_workspace` and the real Claude spawn in
// `send_message` are exercised by manual end-to-end verification (see
// docs/features/26-driving-api.md); the git worktree itself is already tested in
// overseer-core.

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Path, Query, State};
    use axum::http::StatusCode;
    use chrono::Utc;
    use overseer_core::agents::event::{AgentEvent, ToolMeta};
    use overseer_core::persistence::{save_project_registry, Project, ProjectRegistry, Workspace};

    /// A temp directory that deletes itself on drop.
    struct TempConfigDir {
        path: std::path::PathBuf,
    }

    impl TempConfigDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "overseer-http-api-v1-test-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempConfigDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn sample_workspace(id: &str, path: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            project_id: Some("proj-1".to_string()),
            repo_id: None,
            branch: "feature-x".to_string(),
            path: path.to_string(),
            is_archived: false,
            created_at: Utc::now(),
            pr_number: None,
            pr_url: None,
            pr_state: None,
            is_creating: None,
            is_archiving: None,
            ssh_host_id: None,
        }
    }

    fn sample_project(workspaces: Vec<Workspace>) -> Project {
        Project {
            id: "proj-1".to_string(),
            name: "overseer".to_string(),
            path: "/tmp/overseer".to_string(),
            is_git_repo: true,
            workspaces,
            worktrees: vec![],
            init_prompt: None,
            pr_prompt: None,
            post_create: None,
            workspace_filter: None,
            worktree_filter: None,
            use_github: None,
            allow_merge_to_main: None,
            main_branch: None,
        }
    }

    /// Build a state with a saved registry containing one project + workspace
    /// whose worktree directory name is "dugong".
    fn state_with_workspace() -> (Arc<HttpSharedState>, TempConfigDir) {
        let temp = TempConfigDir::new();
        let state = Arc::new(HttpSharedState::with_config_dir(temp.path.clone()));
        let registry = ProjectRegistry {
            projects: vec![sample_project(vec![sample_workspace(
                "ws-1",
                "/tmp/overseer/dugong",
            )])],
        };
        save_project_registry(&temp.path, &registry).unwrap();
        (state, temp)
    }

    fn value_of<T: Serialize>(response: Json<ApiEnvelope<T>>) -> serde_json::Value {
        serde_json::to_value(response.0).unwrap()
    }

    async fn create_session(state: &Arc<HttpSharedState>, workspace_id: &str) -> String {
        let body =
            serde_json::from_value(serde_json::json!({ "label": "driven by test" })).unwrap();
        let response = super::sessions::create_session(
            State(state.clone()),
            Path(workspace_id.to_string()),
            Json(body),
        )
        .await
        .unwrap();
        value_of(response)["data"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn list_projects_returns_registered_project() {
        let (state, _temp) = state_with_workspace();
        let response = super::workspaces::list_projects(State(state.clone()))
            .await
            .unwrap();
        let value = value_of(response);
        assert_eq!(value["success"], true);
        assert_eq!(value["data"][0]["id"], "proj-1");
        assert_eq!(value["data"][0]["name"], "overseer");
    }

    #[tokio::test]
    async fn create_session_writes_metadata_and_index() {
        let (state, temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;

        // Metadata written under chats/{project}/{workspace}/.
        let meta_path = temp
            .path
            .join("chats/overseer/dugong")
            .join(format!("{session_id}.meta.json"));
        assert!(meta_path.exists(), "session meta.json should be written");

        // Chat index (sidebar) updated.
        let index_path = temp.path.join("chats/overseer/dugong/chats.json");
        assert!(index_path.exists(), "chats.json index should be written");
    }

    #[tokio::test]
    async fn create_session_for_unknown_workspace_is_404() {
        let (state, _temp) = state_with_workspace();
        let body = serde_json::from_value(serde_json::json!({})).unwrap();
        let result = super::sessions::create_session(
            State(state.clone()),
            Path("does-not-exist".to_string()),
            Json(body),
        )
        .await;
        let Err(err) = result else {
            panic!("expected a not-found error");
        };
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }

    /// A realistic single turn appended straight to the session, then flushed.
    fn append_sample_turn(state: &HttpSharedState, session_id: &str) {
        let events = vec![
            AgentEvent::UserMessage {
                id: "u1".to_string(),
                content: "list the files".to_string(),
                timestamp: Utc::now(),
                meta: None,
            },
            // Hidden system echo that send_message would add.
            AgentEvent::UserMessage {
                id: "u2".to_string(),
                content: "list the files".to_string(),
                timestamp: Utc::now(),
                meta: Some(serde_json::json!({ "type": "system", "label": "System" })),
            },
            AgentEvent::Message {
                content: "I should run ls.".to_string(),
                tool_meta: Some(ToolMeta {
                    tool_name: "Thinking".to_string(),
                    lines_added: Some(0),
                    lines_removed: Some(0),
                }),
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            },
            AgentEvent::Message {
                content: "[Bash]\n{\n  \"command\": \"ls\"\n}".to_string(),
                tool_meta: None,
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            },
            AgentEvent::Message {
                content: "There are 3 files: a.rs, b.rs, c.rs.".to_string(),
                tool_meta: None,
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            },
            AgentEvent::TurnComplete,
        ];
        for event in events {
            state
                .context
                .chat_sessions
                .append_event(session_id, event)
                .unwrap();
        }
        // Flush buffered events to disk so the read path (which reads disk) sees them.
        state
            .context
            .chat_sessions
            .unregister_session(session_id)
            .unwrap();
    }

    async fn read(
        state: &Arc<HttpSharedState>,
        session_id: &str,
        query: serde_json::Value,
    ) -> serde_json::Value {
        let query = serde_json::from_value(query).unwrap();
        let response = super::messages::read_messages(
            State(state.clone()),
            Path(session_id.to_string()),
            Query(query),
        )
        .await
        .unwrap();
        value_of(response)
    }

    #[tokio::test]
    async fn read_text_view_returns_only_exchange() {
        let (state, _temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;
        append_sample_turn(&state, &session_id);

        let value = read(&state, &session_id, serde_json::json!({ "view": "text" })).await;
        let messages = value["data"]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["text"], "There are 3 files: a.rs, b.rs, c.rs.");
        assert_eq!(value["data"]["turnComplete"], true);
        assert_eq!(value["data"]["running"], false);
        assert_eq!(value["data"]["lastSeq"], 6);
    }

    #[tokio::test]
    async fn read_full_view_includes_thinking_and_tools() {
        let (state, _temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;
        append_sample_turn(&state, &session_id);

        let value = read(&state, &session_id, serde_json::json!({ "view": "full" })).await;
        let messages = value["data"]["messages"].as_array().unwrap();
        // user, thinking, tool, assistant text.
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[1]["kind"], "thinking");
        assert_eq!(messages[2]["kind"], "tool");
        assert_eq!(messages[2]["toolName"], "Bash");
    }

    #[tokio::test]
    async fn read_since_seq_returns_only_newer_events() {
        let (state, _temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;
        append_sample_turn(&state, &session_id);

        // Everything after the tool call (seq 4) — just the assistant text (seq 5).
        let value = read(
            &state,
            &session_id,
            serde_json::json!({ "view": "text", "sinceSeq": 4 }),
        )
        .await;
        let messages = value["data"]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["seq"], 5);
        assert_eq!(messages[0]["role"], "assistant");
    }

    #[tokio::test]
    async fn get_session_reports_status() {
        let (state, _temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;
        append_sample_turn(&state, &session_id);

        let response = super::sessions::get_session(State(state.clone()), Path(session_id.clone()))
            .await
            .unwrap();
        let value = value_of(response);
        assert_eq!(value["data"]["sessionId"], session_id);
        assert_eq!(value["data"]["workspaceId"], "ws-1");
        assert_eq!(value["data"]["label"], "driven by test");
        assert_eq!(value["data"]["running"], false);
        assert_eq!(value["data"]["lastSeq"], 6);
    }

    #[tokio::test]
    async fn upload_attachment_stores_file_and_returns_metadata() {
        let (state, temp) = state_with_workspace();
        let session_id = create_session(&state, "ws-1").await;

        let query = serde_json::from_value(serde_json::json!({ "filename": "notes.md" })).unwrap();
        let response = super::attachments::upload_attachment(
            State(state.clone()),
            Path(session_id),
            Query(query),
            axum::body::Bytes::from_static(b"hello from the driver"),
        )
        .await
        .unwrap();

        let value = value_of(response);
        assert_eq!(value["success"], true);
        assert_eq!(value["data"]["filename"], "notes.md");
        assert_eq!(value["data"]["mimeType"], "text/markdown");
        assert_eq!(value["data"]["size"], 21);

        // File written under {config}/attachments/{id}/notes.md.
        let path = value["data"]["path"].as_str().unwrap();
        assert!(std::path::Path::new(path).exists());
        assert!(path.starts_with(temp.path.join("attachments").to_str().unwrap()));
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            "hello from the driver"
        );
    }

    #[tokio::test]
    async fn upload_attachment_for_unknown_session_is_404() {
        let (state, _temp) = state_with_workspace();
        let query = serde_json::from_value(serde_json::json!({ "filename": "x.txt" })).unwrap();
        let result = super::attachments::upload_attachment(
            State(state.clone()),
            Path("nope".to_string()),
            Query(query),
            axum::body::Bytes::from_static(b"data"),
        )
        .await;
        let Err(err) = result else {
            panic!("expected a not-found error");
        };
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unknown_session_is_404() {
        let (state, _temp) = state_with_workspace();
        let result =
            super::sessions::get_session(State(state.clone()), Path("nope".to_string())).await;
        let Err(err) = result else {
            panic!("expected a not-found error");
        };
        assert_eq!(err.status, StatusCode::NOT_FOUND);
    }
}
