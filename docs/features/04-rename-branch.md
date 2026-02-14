# Plan: Rename Branch

## Context

When creating a workspace, the branch name is set at creation time. Sometimes you want to rename it after the fact — e.g., Claude helped you build something and now you want a more descriptive branch name before opening a PR.

## Current State

- Branch name is displayed in `ChatWindow.tsx` header and `WorkspaceList.tsx`
- Branch is stored in the `Workspace` type: `{ branch: string, path: string, ... }`
- `RepoStore` persists workspace metadata to `~/.config/overseer/repos.json`
- Git operations are in `src-tauri/src/lib.rs`
- No rename functionality exists

## Design

Add a clickable/editable branch name in the chat header. Clicking it turns it into an input field. On Enter, it runs `git branch -m` and updates the store.

## Files to Modify

### 1. `src-tauri/src/lib.rs`

- Add `rename_branch(workspace_path: &str, old_name: &str, new_name: &str)` Tauri command
- Run `git branch -m {old_name} {new_name}` in the workspace directory
- Return success or error string

### 2. `src/renderer/services/git.ts`

- Add `renameBranch(workspacePath: string, oldName: string, newName: string): Promise<void>`
- Invoke the new Tauri command

### 3. `src/renderer/stores/RepoStore.ts`

- Add `renameBranch(workspaceId: string, newName: string)` action
- Call `gitService.renameBranch()` with the workspace path and old/new names
- Update the workspace's `branch` field in the store
- Call `saveToFile()` to persist

### 4. `src/renderer/components/chat/ChatWindow.tsx`

- Make the branch name in the header editable
- Add local state: `editing: boolean`, `newBranchName: string`
- Click on branch name -> switch to input field, pre-filled with current name
- Enter -> call `repoStore.renameBranch()`, exit edit mode
- Escape -> cancel, revert to original name
- Show a subtle edit icon or underline hint on hover

### 5. `src/renderer/components/repos/WorkspaceList.tsx`

- Branch name displayed here will update reactively via MobX
- No changes needed if store is the source of truth (it is)

## UI Sketch

### Display mode:

```
┌─ feature/login ✎ ──────── /path/to/workspace ─┐
```

### Edit mode:

```
┌─ [feature/new-name________] ── /path/to/wt ──┐
```

## Edge Cases

- Branch name conflicts: `git branch -m` will fail, surface the error
- Invalid branch names (spaces, special chars): let git validate and show error
- Active Claude session: renaming branch mid-session is fine, git allows it
- Main/master branch: renaming is allowed by git but could be surprising — no special guard needed
- Remote tracking: this only renames locally, push with `-u` is the user's responsibility
