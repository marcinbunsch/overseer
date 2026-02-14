# Plan: Changed Files Pane

## Context

The inspiration UI shows a "Changes" tab in the right panel listing files modified on the current branch compared to the base branch. This gives a quick overview of what Claude has touched without switching to a terminal or git GUI.

## Current State

- Right pane currently only shows the terminal
- Git operations are handled in `src-tauri/src/lib.rs` via shell commands
- The selected workspace (with its path and branch) is available in `repoStore`
- No diffing or file-change tracking exists

## Design

Add a tabbed view in the right pane: "Terminal" | "Changes". The Changes tab runs `git diff --name-status` against the base branch and displays a file list with change-type indicators (M/A/D).

## Files to Modify

### 1. `src-tauri/src/lib.rs`

- Add `list_changed_files(workspace_path: &str)` Tauri command
- Run `git diff --name-status HEAD...main` (or detect the default branch)
- Also include untracked files via `git ls-files --others --exclude-standard`
- Parse output into a vec of `{ status: String, path: String }`
- Add a `get_default_branch(repo_path: &str)` helper that checks for `main` or `master`

### 2. `src/renderer/services/git.ts`

- Add `listChangedFiles(workspacePath: string): Promise<ChangedFile[]>`
- Add `ChangedFile` interface: `{ status: "M" | "A" | "D" | "?", path: string }`
- Invoke the new Tauri command

### 3. `src/renderer/types/index.ts`

- Add `ChangedFile` type if not colocated with git service

### 4. `src/renderer/components/layout/RightPane.tsx`

- Add tab bar: "Terminal" | "Changes"
- Track active tab in local state
- Render `TerminalPane` or `ChangedFilesPane` based on active tab

### 5. `src/renderer/components/changes/ChangedFilesPane.tsx` (new file)

- Accept `workspacePath: string` prop
- On mount (and on a refresh button click), call `gitService.listChangedFiles()`
- Display file list with status indicators:
  - M (modified) — accent/silver color
  - A (added) — green
  - D (deleted) — red/muted
  - ? (untracked) — dim
- Show relative file paths
- Optional: refresh button in the header
- Optional: click a file to show its diff in the middle pane (future)

## UI Sketch

```
┌─ [Terminal] [Changes] ─── [VS Code] [iTerm] ─┐
│                                                │
│  M  src/renderer/App.tsx                       │
│  M  src/renderer/stores/ConfigStore.ts         │
│  A  src/renderer/components/new/Thing.tsx       │
│  D  src/renderer/old/Unused.tsx                │
│  ?  notes.txt                                  │
│                                                │
│                          [Refresh]             │
└────────────────────────────────────────────────┘
```

## Edge Cases

- Workspace on `main` itself: diff against `HEAD~1` or show nothing
- No changes: show "No changed files" message
- Detached HEAD: handle gracefully, maybe skip diff
- Large number of files: scrollable list, no pagination needed
- Auto-refresh: could poll every N seconds or refresh after Claude process exits
