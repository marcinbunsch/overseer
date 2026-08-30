//! MCP server (`/mcp`) exposing Overseer's driving verbs as tools.
//!
//! This mirrors the `/api/v1` driving API, but over the Model Context Protocol
//! so any MCP client (Claude Desktop, an agent, a script) can create a
//! workspace, start a session, send a message, and read the replies.
//!
//! Each tool wraps the matching `api_v1` handler rather than reimplementing its
//! logic — the request body is built with `serde_json` (the handlers' body types
//! have private fields, and `serde_json::from_value` deserializes without naming
//! them), and the handler's `{ success, data }` envelope is returned verbatim as
//! the tool's text content.
//!
//! The service is mounted at `/mcp` inside the HTTP server's protected router
//! (see `lib.rs`), so the same bearer-token auth guards it — there is no
//! MCP-specific auth here.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::response::Json;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo,
};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};
use serde::Deserialize;
use serde_json::json;

use crate::api_v1::{messages, sessions, workspaces};
use crate::api_v1::ApiError;
use crate::HttpSharedState;

/// The MCP handler. Holds the shared HTTP state so its tools can call the same
/// `overseer-core` managers the desktop app and driving API use.
#[derive(Clone)]
pub struct OverseerMcp {
    state: Arc<HttpSharedState>,
}

impl OverseerMcp {
    pub fn new(state: Arc<HttpSharedState>) -> Self {
        Self { state }
    }
}

// ============================================================================
// TOOL INPUTS
// ============================================================================
//
// Field names are the MCP-facing schema; the doc comments become the schema
// descriptions. They are independent of the `api_v1` body types, which use
// camelCase — the `json!` bodies below translate between the two.

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateWorkspaceArgs {
    /// Project id to create the workspace in (from `list_projects`).
    project_id: String,
    /// Branch name for the new git worktree.
    branch: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct CreateSessionArgs {
    /// Workspace id to start the session in (from `create_workspace`).
    workspace_id: String,
    /// Optional label shown in the desktop sidebar.
    label: Option<String>,
    /// Optional Claude model version (e.g. "sonnet", "opus").
    model_version: Option<String>,
    /// Optional permission mode. Defaults to `bypassPermissions` so nothing
    /// pauses for a human to approve.
    permission_mode: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SessionArgs {
    /// Session id (from `create_session`).
    session_id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SendMessageArgs {
    /// Session id to send the message to.
    session_id: String,
    /// The message text. Returns immediately; poll `read_messages` for the reply.
    text: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ReadMessagesArgs {
    /// Session id to read from.
    session_id: String,
    /// Detail level: `text` (default) for just the exchange, or `full` for
    /// thinking, tool calls and tool output.
    view: Option<String>,
    /// Return only messages after this sequence number. Pass back the `lastSeq`
    /// from the previous read to poll for new messages.
    since_seq: Option<u64>,
}

// ============================================================================
// TOOLS
// ============================================================================

#[tool_router]
impl OverseerMcp {
    /// List the projects a driver can target.
    #[tool(description = "List the projects available to drive. Returns [{ id, name, path }].")]
    async fn list_projects(&self) -> Result<CallToolResult, McpError> {
        let Json(envelope) = workspaces::list_projects(State(self.state.clone()))
            .await
            .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }

    /// Create a workspace (a git worktree on a new branch) in a project.
    #[tool(description = "Create a workspace (git worktree on a new branch) in a project. \
        Returns { id, projectId, name, branch, path }.")]
    async fn create_workspace(
        &self,
        Parameters(args): Parameters<CreateWorkspaceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = json!({ "branch": args.branch });
        let Json(envelope) = workspaces::create_workspace(
            State(self.state.clone()),
            Path(args.project_id),
            Json(from_json(body)?),
        )
        .await
        .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }

    /// Start a Claude session in a workspace.
    #[tool(description = "Start a session in a workspace. Runs in bypassPermissions mode by \
        default. Returns { sessionId }.")]
    async fn create_session(
        &self,
        Parameters(args): Parameters<CreateSessionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = json!({
            "label": args.label,
            "modelVersion": args.model_version,
            "permissionMode": args.permission_mode,
        });
        let Json(envelope) = sessions::create_session(
            State(self.state.clone()),
            Path(args.workspace_id),
            Json(from_json(body)?),
        )
        .await
        .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }

    /// Read a session's status.
    #[tool(description = "Get a session's status: { sessionId, workspaceId, label, agentType, \
        running, lastSeq }.")]
    async fn get_session(
        &self,
        Parameters(args): Parameters<SessionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let Json(envelope) = sessions::get_session(State(self.state.clone()), Path(args.session_id))
            .await
            .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }

    /// Send a message to a session. Does not wait for the reply.
    #[tool(description = "Send a message to a session. Returns immediately with { accepted, \
        lastSeq } — it does NOT wait for the reply. Poll read_messages with since_seq=lastSeq \
        until turnComplete is true, then the new messages hold the agent's reply.")]
    async fn send_message(
        &self,
        Parameters(args): Parameters<SendMessageArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = json!({ "text": args.text });
        let Json(envelope) = messages::send_message(
            State(self.state.clone()),
            Path(args.session_id),
            Json(from_json(body)?),
        )
        .await
        .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }

    /// Read a session's messages with a poll cursor.
    #[tool(description = "Read a session's messages. Returns { messages, lastSeq, running, \
        turnComplete }. Use since_seq to fetch only new messages while polling for a reply.")]
    async fn read_messages(
        &self,
        Parameters(args): Parameters<ReadMessagesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let query = json!({ "view": args.view, "sinceSeq": args.since_seq });
        let Json(envelope) = messages::read_messages(
            State(self.state.clone()),
            Path(args.session_id),
            Query(from_json(query)?),
        )
        .await
        .map_err(to_mcp_error)?;
        ok_json(&envelope)
    }
}

#[tool_handler]
impl ServerHandler for OverseerMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "overseer-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Drive Overseer over MCP: list_projects → create_workspace → create_session → \
                 send_message, then poll read_messages with since_seq until turnComplete is true.",
            )
    }
}

// ============================================================================
// HELPERS
// ============================================================================

/// Deserialize a `serde_json::Value` into a handler body/query type. A failure
/// here is a bug in the tool wrapper, not caller input, so it maps to an
/// internal error.
fn from_json<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, McpError> {
    serde_json::from_value(value)
        .map_err(|error| McpError::internal_error(format!("Building request: {error}"), None))
}

/// Return an `api_v1` envelope as the tool's text content, serialized as JSON.
fn ok_json<T: serde::Serialize>(envelope: &T) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string(envelope)
        .map_err(|error| McpError::internal_error(format!("Serializing response: {error}"), None))?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

/// Map a driving-API error onto the right MCP/JSON-RPC error. 4xx is the
/// caller's problem (invalid params); anything else is a server-side failure.
fn to_mcp_error(error: ApiError) -> McpError {
    let message = error.message().to_string();
    if error.status_code().is_client_error() {
        McpError::invalid_params(message, None)
    } else {
        McpError::internal_error(message, None)
    }
}

// ============================================================================
// TESTS
// ============================================================================
//
// These call the tool methods directly on an `OverseerMcp` instance — no HTTP
// transport — mirroring how the `api_v1` handler tests work. They cover the
// wrapper logic (envelope in, tool content out, error mapping); the git worktree
// in `create_workspace` and the real Claude spawn in `send_message` are verified
// manually (see docs/features/27-mcp-server.md).

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use overseer_core::agents::event::{AgentEvent, ToolMeta};
    use overseer_core::persistence::{save_project_registry, Project, ProjectRegistry, Workspace};
    use rmcp::model::ErrorCode;

    /// A temp directory that deletes itself on drop.
    struct TempConfigDir {
        path: std::path::PathBuf,
    }

    impl TempConfigDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("overseer-http-mcp-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempConfigDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// A state with one project + workspace whose worktree directory is "dugong".
    fn mcp_with_workspace() -> (OverseerMcp, TempConfigDir) {
        let temp = TempConfigDir::new();
        let state = Arc::new(HttpSharedState::with_config_dir(temp.path.clone()));
        let workspace = Workspace {
            id: "ws-1".to_string(),
            project_id: Some("proj-1".to_string()),
            repo_id: None,
            branch: "feature-x".to_string(),
            path: "/tmp/overseer/dugong".to_string(),
            is_archived: false,
            created_at: Utc::now(),
            pr_number: None,
            pr_url: None,
            pr_state: None,
            is_creating: None,
            is_archiving: None,
            ssh_host_id: None,
        };
        let project = Project {
            id: "proj-1".to_string(),
            name: "overseer".to_string(),
            path: "/tmp/overseer".to_string(),
            is_git_repo: true,
            workspaces: vec![workspace],
            worktrees: vec![],
            init_prompt: None,
            pr_prompt: None,
            post_create: None,
            workspace_filter: None,
            worktree_filter: None,
            use_github: None,
            allow_merge_to_main: None,
            main_branch: None,
            default_sandboxed: None,
            claude_config_dir: None,
        };
        save_project_registry(
            &temp.path,
            &ProjectRegistry {
                projects: vec![project],
            },
        )
        .unwrap();
        (OverseerMcp::new(state), temp)
    }

    /// The JSON parsed from a tool's first text content block.
    fn tool_json(result: CallToolResult) -> serde_json::Value {
        let text = &result.content[0].as_text().unwrap().text;
        serde_json::from_str(text).unwrap()
    }

    async fn create_session(mcp: &OverseerMcp) -> String {
        let result = mcp
            .create_session(Parameters(CreateSessionArgs {
                workspace_id: "ws-1".to_string(),
                label: Some("driven by mcp".to_string()),
                model_version: None,
                permission_mode: None,
            }))
            .await
            .unwrap();
        tool_json(result)["data"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// A realistic single turn appended straight to the session, then flushed.
    fn append_sample_turn(mcp: &OverseerMcp, session_id: &str) {
        let events = vec![
            AgentEvent::UserMessage {
                id: "u1".to_string(),
                content: "list the files".to_string(),
                timestamp: Utc::now(),
                meta: None,
            },
            AgentEvent::Message {
                content: "There are 3 files: a.rs, b.rs, c.rs.".to_string(),
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
                content: "There are 3 files: a.rs, b.rs, c.rs.".to_string(),
                tool_meta: None,
                parent_tool_use_id: None,
                tool_use_id: None,
                is_info: None,
            },
            AgentEvent::TurnComplete,
        ];
        for event in events {
            mcp.state
                .context
                .chat_sessions
                .append_event(session_id, event)
                .unwrap();
        }
        // Flush buffered events to disk so the read path (which reads disk) sees them.
        mcp.state
            .context
            .chat_sessions
            .unregister_session(session_id)
            .unwrap();
    }

    #[tokio::test]
    async fn list_projects_tool_returns_registered_project() {
        let (mcp, _temp) = mcp_with_workspace();
        let value = tool_json(mcp.list_projects().await.unwrap());
        assert_eq!(value["success"], true);
        assert_eq!(value["data"][0]["id"], "proj-1");
        assert_eq!(value["data"][0]["name"], "overseer");
    }

    #[tokio::test]
    async fn create_session_tool_writes_metadata_and_index() {
        let (mcp, temp) = mcp_with_workspace();
        let session_id = create_session(&mcp).await;

        let meta_path = temp
            .path
            .join("chats/overseer/dugong")
            .join(format!("{session_id}.meta.json"));
        assert!(meta_path.exists(), "session meta.json should be written");
        let index_path = temp.path.join("chats/overseer/dugong/chats.json");
        assert!(index_path.exists(), "chats.json index should be written");
    }

    #[tokio::test]
    async fn read_messages_tool_folds_turn() {
        let (mcp, _temp) = mcp_with_workspace();
        let session_id = create_session(&mcp).await;
        append_sample_turn(&mcp, &session_id);

        let result = mcp
            .read_messages(Parameters(ReadMessagesArgs {
                session_id,
                view: Some("text".to_string()),
                since_seq: None,
            }))
            .await
            .unwrap();
        let value = tool_json(result);
        let messages = value["data"]["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["text"], "There are 3 files: a.rs, b.rs, c.rs.");
        assert_eq!(value["data"]["turnComplete"], true);
    }

    #[tokio::test]
    async fn unknown_workspace_maps_to_invalid_params() {
        let (mcp, _temp) = mcp_with_workspace();
        let result = mcp
            .create_session(Parameters(CreateSessionArgs {
                workspace_id: "does-not-exist".to_string(),
                label: None,
                model_version: None,
                permission_mode: None,
            }))
            .await;
        let Err(error) = result else {
            panic!("expected a not-found error");
        };
        // 404 is the caller's problem → invalid_params, not an opaque internal error.
        assert_eq!(error.code, ErrorCode::INVALID_PARAMS);
    }
}
