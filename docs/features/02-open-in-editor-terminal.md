# Plan: Open in VS Code / iTerm Buttons

## Context

The inspiration UI has quick-action buttons to open the workspace directory in an external editor or terminal. This is a common workflow shortcut — you're reviewing Claude's changes and want to jump into VS Code or iTerm to inspect/test.

## Current State

- Workspace paths are known and stored in `RepoStore`
- The selected workspace is available via `repoStore.selectedWorkspace`
- Tauri shell plugin is already configured (`shell:allow-open` in capabilities)
- No external app launch buttons exist in the UI

## Design

Add small icon buttons in the right pane header (next to "TERMINAL") or in the workspace list item. Clicking opens the workspace path in VS Code or iTerm.

## Files to Modify

### 1. `src/renderer/services/external.ts` (new file)

- `openInVSCode(path: string)`: invoke shell open with `code {path}`
- `openInITerm(path: string)`: use `open -a iTerm {path}` on macOS
- Could use Tauri's `shell.open` or `shell.execute` depending on what works

### 2. `src-tauri/capabilities/default.json`

- Add shell execute permission for `code` and `open` commands:
  ```json
  { "name": "code", "cmd": "code", "args": true }
  { "name": "open", "cmd": "open", "args": true }
  ```

### 3. `src/renderer/components/layout/RightPane.tsx`

- Add icon buttons in the header bar next to "TERMINAL"
- VS Code icon button and iTerm/terminal icon button
- Both disabled when no workspace is selected
- On click, call the external service with `repoStore.selectedWorkspace.path`

### 4. (Alternative) `src/renderer/components/repos/WorkspaceList.tsx`

- Add small icon buttons on each workspace row
- Appears on hover, similar to the archive (x) button

## UI Sketch

```
┌─ TERMINAL ──────────── [VS Code] [iTerm] ─┐
│                                             │
│  terminal content...                        │
│                                             │
└─────────────────────────────────────────────┘
```

Buttons could be small icons (folder-code, terminal) rather than text labels.

## Edge Cases

- VS Code not installed: `code` command will fail, show error toast
- iTerm not installed: fall back to Terminal.app (`open -a Terminal {path}`)
- No workspace selected: buttons should be disabled/hidden
- Linux/Windows: different commands needed (`xdg-open`, `wt.exe`), but macOS-first is fine
