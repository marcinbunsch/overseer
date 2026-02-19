//! Persistence layer for chats, projects, and approvals.
//!
//! # Overview
//!
//! This module handles all file I/O for Overseer's persistent state:
//!
//! - **Chats** - Individual chat files with full message history
//! - **Index** - Quick-lookup chat index and workspace state
//! - **Projects** - Project registry with workspace definitions
//! - **Approvals** - User-approved tools and command prefixes
//!
//! # File Locations
//!
//! All data lives under the app's config directory:
//!
//! ```text
//! ~/.config/overseer/              (or platform equivalent)
//! ├── projects.json                # Project registry
//! └── workspaces/
//!     └── <workspace-id>/
//!         ├── index.json           # Chat index for this workspace
//!         ├── state.json           # Workspace state (active chat, etc.)
//!         ├── approvals.json       # Approved tools/commands
//!         └── chats/
//!             ├── <chat-id>.json   # Individual chat files
//!             └── ...
//! ```
//!
//! # Design Principles
//!
//! ## Atomic Writes
//!
//! All save operations use write-then-rename to prevent corruption:
//!
//! 1. Write to `file.json.tmp`
//! 2. Rename to `file.json` (atomic on Unix)
//!
//! ## Lazy Loading
//!
//! Chat messages are loaded on-demand, not at startup. The index
//! provides quick metadata without loading full chat content.
//!
//! # Usage
//!
//! ```ignore
//! use overseer_core::persistence::{
//!     chat::{save_chat, load_chat},
//!     index::{load_chat_index, save_chat_index},
//!     projects::{load_project_registry, save_project_registry},
//!     approvals::{load_approvals, save_approvals},
//! };
//! ```

pub mod approvals;
pub mod chat;
pub mod chat_jsonl;
pub mod index;
pub mod projects;
pub mod types;

// Re-export commonly used items for convenience
pub use approvals::{
    add_command_prefix, add_tool_name, command_matches_prefix, delete_approvals,
    has_command_prefix, has_tool_name, load_approvals, remove_command_prefix, remove_tool_name,
    save_approvals,
};
pub use chat::{chat_exists, delete_chat, list_chat_ids, load_chat, save_chat};
pub use chat_jsonl::{
    append_chat_event, count_events, load_chat_events, load_chat_events_since_seq,
    load_chat_events_with_seq, load_chat_metadata, migrate_chat_if_needed, save_chat_metadata,
    serialize_event_for_storage, ChatJsonlError, SeqEvent,
};
pub use index::{
    find_chat_entry, get_active_chats, get_archived_chats, load_chat_index, load_workspace_state,
    remove_chat_entry, save_chat_index, save_workspace_state, upsert_chat_entry, IndexError,
};
pub use projects::{
    add_workspace, find_project, find_project_by_path, find_workspace, find_workspace_by_branch,
    get_active_workspaces, get_archived_workspaces, load_project_registry, remove_project,
    remove_workspace, save_project_registry, upsert_project, ProjectError,
};
pub use types::*;
