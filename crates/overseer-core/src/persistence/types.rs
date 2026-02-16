//! Persistence data types.
//!
//! # Data Model Overview
//!
//! Overseer persists data in several JSON files:
//!
//! ```text
//! ~/.config/overseer/
//! ├── projects.json           # All projects and their workspaces
//! ├── repos.json              # Legacy alias (backward compat)
//! ├── config.json             # App settings
//! └── chats/
//!     └── {project_name}/
//!         ├── approvals.json  # Project-level tool approvals
//!         └── {workspace}/
//!             ├── workspace.json  # Active chat ID
//!             ├── chats.json      # Chat index (metadata)
//!             └── {chat_id}.json  # Individual chat (messages)
//! ```
//!
//! # Design Principles
//!
//! - **Lazy loading**: Chat messages loaded on-demand, not at startup
//! - **Debounced writes**: Prevent excessive disk I/O
//! - **Backward compatibility**: Support legacy field names
//! - **Atomic writes**: Write to temp file, then rename

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::agents::event::ToolMeta;

// ============================================================================
// Chat Types
// ============================================================================

/// A complete chat file with all messages.
///
/// This is the full chat structure saved to `{chat_id}.json`.
/// Messages are loaded lazily when the chat becomes active.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFile {
    /// Unique chat identifier.
    pub id: String,

    /// The workspace this chat belongs to.
    pub workspace_id: String,

    /// User-visible chat name.
    pub label: String,

    /// All messages in this chat.
    pub messages: Vec<Message>,

    /// The agent type: "claude", "codex", "copilot", "gemini", "opencode".
    #[serde(default)]
    pub agent_type: Option<String>,

    /// Agent session ID for reconnection/resumption.
    #[serde(default)]
    pub agent_session_id: Option<String>,

    /// Selected model version.
    #[serde(default)]
    pub model_version: Option<String>,

    /// Permission mode (for Claude).
    #[serde(default)]
    pub permission_mode: Option<String>,

    /// When this chat was created.
    pub created_at: DateTime<Utc>,

    /// When this chat was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Chat metadata stored separately from messages.
///
/// Saved to `{chat_id}.meta.json` alongside `{chat_id}.jsonl`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMetadata {
    /// Unique chat identifier.
    pub id: String,

    /// The workspace this chat belongs to.
    pub workspace_id: String,

    /// User-visible chat name.
    pub label: String,

    /// The agent type: "claude", "codex", "copilot", "gemini", "opencode".
    #[serde(default)]
    pub agent_type: Option<String>,

    /// Agent session ID for reconnection/resumption.
    #[serde(default)]
    pub agent_session_id: Option<String>,

    /// Selected model version.
    #[serde(default)]
    pub model_version: Option<String>,

    /// Permission mode (for Claude).
    #[serde(default)]
    pub permission_mode: Option<String>,

    /// When this chat was created.
    pub created_at: DateTime<Utc>,

    /// When this chat was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A single message in a chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Unique message identifier.
    pub id: String,

    /// Message role: "user" or "assistant".
    pub role: String,

    /// Message content (text or formatted tool output).
    pub content: String,

    /// When this message was created.
    pub timestamp: DateTime<Utc>,

    /// Tool metadata (for tool-related messages).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_meta: Option<ToolMeta>,

    /// Additional message metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<MessageMeta>,

    /// True if this is bash command output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_bash_output: Option<bool>,

    /// True if this is an info message (rate limit, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_info: Option<bool>,

    /// Parent Task tool_use_id for subagent grouping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,

    /// Tool use ID (for Task tools).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
}

/// Additional message metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageMeta {
    /// Message type hint.
    #[serde(default)]
    pub message_type: Option<String>,

    /// Any additional data.
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

// ============================================================================
// Chat Index Types
// ============================================================================

/// The chat index file containing metadata for all chats in a workspace.
///
/// Saved to `chats.json`. This lightweight index is loaded at startup,
/// while full chat messages are loaded lazily.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatIndex {
    /// Metadata entries for each chat.
    pub chats: Vec<ChatIndexEntry>,
}

/// Metadata for a single chat in the index.
///
/// Contains just enough info to display in the chat list sidebar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatIndexEntry {
    /// Unique chat identifier.
    pub id: String,

    /// User-visible chat name.
    pub label: String,

    /// The agent type.
    #[serde(default)]
    pub agent_type: Option<String>,

    /// When this chat was created.
    pub created_at: DateTime<Utc>,

    /// When this chat was last updated.
    pub updated_at: DateTime<Utc>,

    /// True if this chat is archived.
    #[serde(default)]
    pub is_archived: Option<bool>,

    /// When this chat was archived.
    #[serde(default)]
    pub archived_at: Option<DateTime<Utc>>,
}

// ============================================================================
// Workspace State Types
// ============================================================================

/// Workspace state saved to `workspace.json`.
///
/// Contains the active chat ID for restoring state on reload.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    /// The currently active chat ID.
    pub active_chat_id: Option<String>,
}

// ============================================================================
// Project Types
// ============================================================================

/// The project registry containing all projects and workspaces.
///
/// Saved to `projects.json` and (for backward compat) `repos.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRegistry {
    /// All registered projects.
    pub projects: Vec<Project>,
}

/// A project (repository) with its workspaces.
///
/// Note: The JSON may have both `workspaces` and `worktrees` fields.
/// We keep both to avoid "duplicate field" errors during deserialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// Unique project identifier.
    pub id: String,

    /// Project name (usually repo name).
    pub name: String,

    /// Path to the project root.
    pub path: String,

    /// True if this is a git repository.
    #[serde(default = "default_true")]
    pub is_git_repo: bool,

    /// All workspaces for this project.
    #[serde(default)]
    pub workspaces: Vec<Workspace>,

    /// Legacy field: worktrees (same as workspaces).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub worktrees: Vec<Workspace>,

    /// Initial prompt template for new chats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init_prompt: Option<String>,

    /// PR description template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_prompt: Option<String>,

    /// Post-create shell command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_create: Option<String>,

    /// Workspace filter pattern.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_filter: Option<String>,

    /// Legacy field: worktreeFilter (same as workspaceFilter).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_filter: Option<String>,

    /// Whether to use GitHub integration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_github: Option<bool>,

    /// Whether to allow merging to main branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_merge_to_main: Option<bool>,
}

impl Project {
    /// Get all workspaces (from either workspaces or worktrees field).
    pub fn get_workspaces(&self) -> &Vec<Workspace> {
        if !self.workspaces.is_empty() {
            &self.workspaces
        } else {
            &self.worktrees
        }
    }

    /// Get workspace filter (from either field).
    pub fn get_workspace_filter(&self) -> Option<&str> {
        self.workspace_filter
            .as_deref()
            .or(self.worktree_filter.as_deref())
    }
}

/// Helper for serde default value.
fn default_true() -> bool {
    true
}

/// A workspace (git worktree or branch) within a project.
///
/// Note: The JSON may have both `projectId` and `repoId` fields.
/// We keep both to avoid "duplicate field" errors during deserialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    /// Unique workspace identifier.
    pub id: String,

    /// The project this workspace belongs to.
    #[serde(default)]
    pub project_id: Option<String>,

    /// Legacy field: repoId (same as projectId).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,

    /// The branch name.
    pub branch: String,

    /// Path to the workspace directory.
    pub path: String,

    /// True if this workspace is archived.
    #[serde(default)]
    pub is_archived: bool,

    /// When this workspace was created.
    pub created_at: DateTime<Utc>,

    /// Associated GitHub PR number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<u64>,

    /// Associated GitHub PR URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,

    /// GitHub PR state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_state: Option<String>,

    /// True if workspace is being created (transient state).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_creating: Option<bool>,

    /// True if workspace is being archived (transient state).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_archiving: Option<bool>,

    /// SSH host ID for remote workspaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host_id: Option<String>,
}

impl Workspace {
    /// Get the project ID (from either projectId or repoId field).
    pub fn get_project_id(&self) -> Option<&str> {
        self.project_id.as_deref().or(self.repo_id.as_deref())
    }
}

// ============================================================================
// Approvals Types
// ============================================================================

/// Project-level tool and command approvals.
///
/// Saved to `approvals.json` at the project level (shared across workspaces).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalsData {
    /// Auto-approved tool names (e.g., "Bash", "Read").
    #[serde(default)]
    pub tool_names: Vec<String>,

    /// Auto-approved command prefixes (e.g., "git status").
    #[serde(default)]
    pub command_prefixes: Vec<String>,
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_file_roundtrip() {
        let chat = ChatFile {
            id: "chat-1".to_string(),
            workspace_id: "ws-1".to_string(),
            label: "Test Chat".to_string(),
            messages: vec![Message {
                id: "msg-1".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                timestamp: Utc::now(),
                tool_meta: None,
                meta: None,
                is_bash_output: None,
                is_info: None,
                parent_tool_use_id: None,
                tool_use_id: None,
            }],
            agent_type: Some("claude".to_string()),
            agent_session_id: Some("sess-1".to_string()),
            model_version: Some("opus".to_string()),
            permission_mode: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&chat).unwrap();
        let parsed: ChatFile = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, "chat-1");
        assert_eq!(parsed.messages.len(), 1);
    }

    #[test]
    fn chat_index_roundtrip() {
        let index = ChatIndex {
            chats: vec![ChatIndexEntry {
                id: "chat-1".to_string(),
                label: "Test Chat".to_string(),
                agent_type: Some("claude".to_string()),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                is_archived: None,
                archived_at: None,
            }],
        };

        let json = serde_json::to_string(&index).unwrap();
        let parsed: ChatIndex = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.chats.len(), 1);
        assert_eq!(parsed.chats[0].id, "chat-1");
    }

    #[test]
    fn workspace_state_roundtrip() {
        let state = WorkspaceState {
            active_chat_id: Some("chat-1".to_string()),
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: WorkspaceState = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.active_chat_id, Some("chat-1".to_string()));
    }

    #[test]
    fn project_registry_roundtrip() {
        let registry = ProjectRegistry {
            projects: vec![Project {
                id: "proj-1".to_string(),
                name: "test-project".to_string(),
                path: "/path/to/project".to_string(),
                is_git_repo: true,
                workspaces: vec![],
                worktrees: vec![],
                init_prompt: None,
                pr_prompt: None,
                post_create: None,
                workspace_filter: None,
                worktree_filter: None,
                use_github: Some(true),
                allow_merge_to_main: None,
            }],
        };

        let json = serde_json::to_string(&registry).unwrap();
        let parsed: ProjectRegistry = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.projects.len(), 1);
        assert_eq!(parsed.projects[0].name, "test-project");
    }

    #[test]
    fn approvals_data_roundtrip() {
        let approvals = ApprovalsData {
            tool_names: vec!["Bash".to_string(), "Read".to_string()],
            command_prefixes: vec!["git status".to_string()],
        };

        let json = serde_json::to_string(&approvals).unwrap();
        let parsed: ApprovalsData = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.tool_names.len(), 2);
        assert_eq!(parsed.command_prefixes.len(), 1);
    }

    #[test]
    fn message_with_tool_meta() {
        let msg = Message {
            id: "msg-1".to_string(),
            role: "assistant".to_string(),
            content: "[Bash]\n{\"command\": \"ls\"}".to_string(),
            timestamp: Utc::now(),
            tool_meta: Some(ToolMeta {
                tool_name: "Bash".to_string(),
                lines_added: None,
                lines_removed: None,
            }),
            meta: None,
            is_bash_output: None,
            is_info: None,
            parent_tool_use_id: None,
            tool_use_id: None,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("toolMeta"));
        assert!(json.contains("Bash"));
    }

    #[test]
    fn camel_case_serialization() {
        let chat = ChatFile {
            id: "chat-1".to_string(),
            workspace_id: "ws-1".to_string(),
            label: "Test".to_string(),
            messages: vec![],
            agent_type: None,
            agent_session_id: None,
            model_version: None,
            permission_mode: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&chat).unwrap();

        // Should use camelCase, not snake_case
        assert!(json.contains("workspaceId"));
        assert!(json.contains("createdAt"));
        assert!(!json.contains("workspace_id"));
        assert!(!json.contains("created_at"));
    }
}
