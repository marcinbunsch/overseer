# SSH Support Implementation - Learnings & Analysis

This document captures the learnings from the SSH support implementation attempt on the `ssh-support` branch.

## What Was Built

### Phase 1-4: Core Infrastructure (Complete)
- `overseer-core` crate with shared protocol types, events, shell utilities
- `overseer-daemon` binary with Unix socket + TCP server
- SSH tunnel management (`ssh -L` for TCP port forwarding)
- Daemon deployment via rsync + remote cargo build
- JSON-RPC protocol for daemon communication
- Session management with ring buffer for event replay
- Claude agent spawning via `session.start`
- Event streaming from daemon to frontend via Tauri events
- `RemoteAgentService` implementing the same `AgentService` interface

### Phase 5: PTY & Git Support (Complete)
- PTY sessions in daemon using `portable-pty`
- Git operations in daemon (`git.changedFiles`, `git.diff`)
- `RemoteTerminalService` for SSH terminal sessions
- `RemoteGitService` for remote git operations
- `ChangedFilesStore` and `DiffViewStore` integration for remote workspaces

### Phase 6: Polish (Partial)
- Auto-connect on workspace selection
- Remote workspace creation (clone repo + create worktree via daemon)

## Architecture Problem Identified

### The Duplication Issue

The current implementation has **duplicate code paths** for the same operations:

1. **Local execution** (Tauri app):
   - `src-tauri/src/git.rs` - Git operations
   - `src-tauri/src/agents/` - Agent spawning
   - Frontend calls Tauri commands directly

2. **Remote execution** (Daemon):
   - `crates/overseer-daemon/src/git.rs` - Same git operations, reimplemented
   - `crates/overseer-daemon/src/session.rs` - Agent spawning, reimplemented
   - Frontend → Tauri → SSH tunnel → Daemon

This means every git operation, every agent interaction, every file operation needs to be:
- Implemented in Tauri for local use
- Reimplemented in the daemon for remote use
- Have corresponding TypeScript services (`gitService` vs `remoteGitService`)
- Have routing logic in stores to choose the right service

### Example: `list_changed_files`

**Current implementation:**

```
Local:
  Frontend → invoke("list_changed_files") → src-tauri/src/git.rs

Remote:
  Frontend → invoke("ssh_git_changed_files") → SSH tunnel → Daemon RPC → daemon/git.rs
```

Both `src-tauri/src/git.rs` and `daemon/git.rs` contain nearly identical code to run `git diff --name-status`, parse the output, etc.

## Proposed Better Architecture

### Single Shared Core

Move all business logic to `overseer-core` crate:

```rust
// overseer-core/src/git.rs
pub fn list_changed_files(workspace_path: &str) -> Result<ChangedFilesResult, GitError> {
    // Single implementation used by both Tauri and Daemon
}

pub fn create_worktree(repo_path: &str, branch: &str) -> Result<String, GitError> {
    // Single implementation
}
```

### Thin Tauri Layer

Tauri commands become thin wrappers:

```rust
// src-tauri/src/git.rs
#[tauri::command]
pub async fn list_changed_files(workspace_path: String) -> Result<ChangedFilesResult, String> {
    overseer_core::git::list_changed_files(&workspace_path)
        .map_err(|e| e.to_string())
}
```

### Thin Daemon Layer

Daemon RPC handlers also become thin wrappers:

```rust
// overseer-daemon/src/server.rs
RpcMethod::GIT_CHANGED_FILES => {
    overseer_core::git::list_changed_files(&params.workspace_path)
        .map(|r| serde_json::to_value(r).unwrap())
        .map_err(|e| RpcError::git_error(e))
}
```

### Benefits

1. **Single source of truth** - One implementation, used everywhere
2. **Easier testing** - Test the core logic once
3. **Consistency** - Local and remote always behave identically
4. **Less code** - No duplication between Tauri and daemon
5. **Simpler frontend** - Could potentially have single service that routes internally

### What Needs to Move to `overseer-core`

1. **Git operations** (currently in `src-tauri/src/git.rs`):
   - `list_workspaces`
   - `list_changed_files`
   - `add_workspace` / `create_worktree`
   - `archive_workspace`
   - `get_file_diff`
   - `check_merge`, `merge_into_main`
   - `rename_branch`, `delete_branch`
   - `get_origin_url`

2. **Agent spawning** (currently in `src-tauri/src/agents/`):
   - `build_login_shell_command` (already partially extracted)
   - Claude stream-json parsing
   - Process management

3. **PTY handling** (currently in `src-tauri/src/pty/`):
   - PTY creation and management
   - Terminal resize

4. **File operations** (if needed for remote):
   - File listing
   - File reading (for diffs, etc.)

## Technical Considerations

### Async vs Sync

- Tauri commands are async by default
- The core operations (git commands, file I/O) are blocking
- Solution: Core provides sync functions, Tauri wraps in `spawn_blocking`

### Error Handling

- Define error types in `overseer-core`
- Tauri and daemon convert to their respective error formats

### State Management

- Core should be stateless where possible
- Session state (ring buffers, running processes) stays in daemon
- Config/project state stays in Tauri app

## Files Changed in This Attempt

### New Files
- `src/renderer/services/sshConnection.ts` - SSH connection management

### Modified Files
- `crates/overseer-core/src/protocol.rs` - Added `WorkspaceCreateParams/Result`
- `crates/overseer-daemon/src/git.rs` - Added workspace creation (clone + worktree)
- `crates/overseer-daemon/src/server.rs` - Added `WORKSPACE_CREATE` handler
- `src-tauri/src/git.rs` - Added `get_origin_url` command
- `src-tauri/src/lib.rs` - Registered new commands
- `src-tauri/src/ssh/client.rs` - Added `workspace_create` method
- `src-tauri/src/ssh/mod.rs` - Added `ssh_workspace_create` command
- `src/renderer/components/chat/ChatWindow.tsx` - Added auto-connect
- `src/renderer/services/git.ts` - Added `getOriginUrl`
- `src/renderer/services/remoteGit.ts` - Added `createWorkspace`
- `src/renderer/stores/ProjectRegistry.ts` - Added remote workspace creation flow

## Recommendation

Before continuing with SSH support, refactor the codebase to:

1. **Extract all business logic to `overseer-core`**
   - Start with git operations (most straightforward)
   - Then agent spawning
   - Then PTY handling

2. **Make Tauri commands thin wrappers**
   - Just parameter conversion and error mapping
   - Call into `overseer-core`

3. **Make daemon RPC handlers thin wrappers**
   - Same pattern as Tauri

4. **Then revisit SSH support**
   - The daemon will automatically have all the same capabilities as local
   - Frontend routing becomes simpler (or could be handled in Rust)
   - No more duplicate implementations

This refactoring will make the codebase more maintainable regardless of SSH support, and will make SSH support much easier to complete correctly.
