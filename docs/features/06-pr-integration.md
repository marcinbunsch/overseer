# Plan: Pull Request Integration

## Context

The inspiration UI shows PR metadata (number, status, checks) in the header. Integrating with GitHub PRs lets users create PRs, view status, and see check results without leaving Overseer. This uses the `gh` CLI which is commonly installed on dev machines.

## Current State

- No GitHub/PR integration exists
- The selected workspace's branch and path are available via `repoStore`
- Shell execution is available via Tauri shell plugin
- `gh` CLI is not yet in the shell allowlist

## Design

Add PR status display in the chat header and a "Create PR" action. Use `gh` CLI commands invoked via Tauri commands in Rust. Show PR status (open/merged/draft), PR URL, and a button to create a PR if none exists for the branch.

## Files to Modify

### 1. `src-tauri/src/lib.rs`

- Add `get_pr_status(workspace_path: &str, branch: &str)` Tauri command
  - Run `gh pr view {branch} --json number,state,title,url,isDraft` in the workspace dir
  - Parse JSON output into a struct
  - Return `None` if no PR exists (gh exits with error)
- Add `create_pr(workspace_path: &str, title: &str, body: &str, draft: bool)` Tauri command
  - Run `gh pr create --title {title} --body {body}` (add `--draft` if draft)
  - Return the PR URL from stdout
- Add `open_pr_in_browser(workspace_path: &str, branch: &str)` Tauri command
  - Run `gh pr view {branch} --web`

### 2. `src-tauri/capabilities/default.json`

- Add `gh` to the shell execute/spawn allowlist:
  ```json
  { "name": "gh", "cmd": "gh", "args": true }
  ```

### 3. `src/renderer/services/git.ts`

- Add PR-related methods:
  - `getPRStatus(workspacePath, branch): Promise<PRStatus | null>`
  - `createPR(workspacePath, title, body, draft): Promise<string>`
  - `openPRInBrowser(workspacePath, branch): Promise<void>`
- Add `PRStatus` interface:
  ```ts
  interface PRStatus {
    number: number
    state: "OPEN" | "MERGED" | "CLOSED"
    title: string
    url: string
    isDraft: boolean
  }
  ```

### 4. `src/renderer/components/chat/ChatWindow.tsx`

- In the header bar, after branch name, show PR status badge:
  - No PR: show "Create PR" button
  - PR exists: show `#123 Open` (or Draft/Merged) as a clickable link
- Clicking the PR badge opens it in the browser
- "Create PR" button opens a small modal/popover

### 5. `src/renderer/components/pr/CreatePRModal.tsx` (new file)

- Simple modal with:
  - Title input (pre-filled with branch name)
  - Body textarea
  - Draft checkbox
  - Create / Cancel buttons
- On create, call `gitService.createPR()`, close modal, refresh status

### 6. `src/renderer/components/pr/PRBadge.tsx` (new file)

- Small inline component showing PR state
- Color-coded: green (open), purple (merged), red (closed), gray (draft)
- Clickable to open in browser
- Auto-refreshes on mount and when Claude process exits

## UI Sketch

### No PR:

```
┌─ feature/login ── /path ──── [Create PR] ─────┐
```

### PR exists:

```
┌─ feature/login ── /path ──── #42 Open ────────┐
```

### Create PR modal:

```
┌─────────────────────────────────┐
│  Create Pull Request            │
│                                 │
│  Title: [feature/login_______]  │
│                                 │
│  Body:                          │
│  [__________________________ ]  │
│  [__________________________ ]  │
│                                 │
│  [x] Draft                      │
│                                 │
│          [Cancel] [Create]      │
└─────────────────────────────────┘
```

## Edge Cases

- `gh` not installed: detect on startup, hide PR features, log warning
- `gh` not authenticated: `gh pr view` will fail, show "gh auth login required" message
- No remote: `gh pr create` will fail, surface error
- Multiple remotes: `gh` uses the default remote, which is usually correct
- Branch not pushed: "Create PR" should push first — or let `gh pr create` handle it (it prompts or fails)
- Polling: refresh PR status when switching workspaces and after Claude exits, not on a timer
