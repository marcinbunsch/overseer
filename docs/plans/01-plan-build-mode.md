# Plan: Plan Mode / Build Mode Toggle

## Context

The inspiration UI shows a toggle between "Plan" and "Build" modes at the top of the conversation area. In Claude CLI, this maps to passing `--permission-mode plan` vs the current default mode. Plan mode restricts Claude to read-only operations (no file writes, no commands), useful for exploring and designing before committing to changes.

## Current State

- `SessionStore.sendMessage()` calls `claudeService.start()` which spawns the Claude CLI
- `start_claude` in `lib.rs` currently hardcodes `--permission-mode default`
- `ChatInput.tsx` has a simple textarea + send button
- No concept of mode exists in the frontend

## Design

A toggle in the chat header (or above the input) switches between Plan and Build. The mode is sent when starting a new Claude session and can be switched mid-conversation by restarting the session.

## Files to Modify

### 1. `src/renderer/types/index.ts`
- Add `type ClaudeMode = "plan" | "build"`
- Add `mode: ClaudeMode` to `Session` interface

### 2. `src/renderer/stores/SessionStore.ts`
- Add `mode: ClaudeMode = "build"` observable
- Add `setMode(mode: ClaudeMode)` action
- Pass `mode` through to the Claude service when starting a session
- Map `"plan"` to `--permission-mode plan` and `"build"` to `--permission-mode default`

### 3. `src-tauri/src/lib.rs`
- Add `permission_mode: &str` parameter to `start_claude` command
- Use the parameter value instead of hardcoded `"default"`

### 4. `src/renderer/services/claude.ts` (or equivalent)
- Pass `permissionMode` parameter through the invoke call to `start_claude`

### 5. `src/renderer/components/chat/ChatWindow.tsx`
- Add a mode toggle in the header bar, next to the branch name
- Two buttons/tabs: "Plan" and "Build"
- Highlight active mode with `--accent` color
- Switching mode while a session is active should warn or restart the session

### 6. `src/renderer/components/chat/ChatInput.tsx`
- Optionally show current mode as a subtle label near the input
- Placeholder text could change: "Plan a change..." vs "Ask Claude to build..."

## UI Sketch

```
┌─ branch-name ─────────────── [Plan] [Build] ─┐
│                                                │
│  messages...                                   │
│                                                │
├────────────────────────────────────────────────┤
│  [input area]                          [Send]  │
└────────────────────────────────────────────────┘
```

## Edge Cases

- Switching mode mid-session: restart Claude process with new mode
- Default mode should be "build" (matches current behavior)
- Mode should persist per-session in SessionStore
