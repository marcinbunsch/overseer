# Plan: Conversation Tabs

## Context

Currently each workspace has a single flat conversation. The user should be able to run multiple independent conversations against the same workspace, displayed as tabs above the chat area. Each tab is a separate Claude session with its own message history.

## Current State

- `SessionStore` maps one session per `workspaceId` via `history: Map<string, Session>`
- `ClaudeService` holds a single process and `sessionId`
- `ChatWindow` renders one `MessageList` from `sessionStore.currentSession`
- Sessions persist to `localStorage` keyed by workspaceId

## Design

Change the data model so a workspace can have multiple conversations. Each conversation is a tab. **Claude processes run independently and survive switching between conversations and workspaces.** The user can start work in one conversation, switch to another, and come back — the original process is still running and streaming events into its conversation's message history.

This requires the backend to manage multiple concurrent Claude processes (keyed by conversation ID) instead of a single global one.

## Files to Modify

### 1. `src/renderer/types/index.ts`

- Add `Conversation` type:
  ```ts
  interface Conversation {
    id: string
    workspaceId: string
    label: string // auto-generated or user-editable, e.g. "Conv 1"
    claudeSessionId: string | null // for --resume
    messages: Message[]
    createdAt: Date
  }
  ```
- `Session` can be simplified or replaced — a session is now just "which conversation is active"

### 2. `src-tauri/src/lib.rs` — Multi-process backend

- Replace single `ClaudeProcess` with a `HashMap<String, ClaudeProcess>` keyed by conversation ID
- Wrap in `Arc<Mutex<...>>` as managed Tauri state
- Modify `start_claude`:
  - Add `conversation_id: &str` parameter
  - Store the spawned process under that key in the map
  - Emit events tagged with the conversation ID: `claude:stdout:{conversation_id}`, etc.
- Modify `claude_stdin`:
  - Add `conversation_id: &str` parameter
  - Look up the correct process by key
- Modify `stop_claude`:
  - Add `conversation_id: &str` parameter
  - Kill only that process, remove from map
- Add `list_running()` command: returns list of conversation IDs with active processes (useful for UI indicators)

### 3. `src/renderer/services/claude.ts` — Multi-session frontend

- Replace single-process model with a map of active sessions keyed by conversation ID
- Each session tracks: `sessionId`, `running`, `buffer`, `rawOutput`
- `sendMessage(conversationId, prompt, workingDir, claudePath, resumeSessionId?)`:
  - If process already running for this conversation, send follow-up via stdin
  - Otherwise start new process, passing conversation ID to backend
- Listen on `claude:stdout:{conversationId}` etc. — register/unregister listeners per conversation
- `stop(conversationId)`: stop a specific process
- `onEvent` / `onDone` callbacks receive conversation ID so SessionStore can route events to the correct conversation
- Remove `resetSession()` global — each conversation manages its own Claude session ID

### 4. `src/renderer/stores/SessionStore.ts`

- Replace `history: Map<string, Session>` with `conversations: Map<string, Conversation[]>` (keyed by workspaceId)
- Add `activeConversationId: string | null` observable
- Add `activeConversation` computed getter
- Add actions:
  - `newConversation(workspaceId)` — creates a new Conversation, switches to it
  - `switchConversation(conversationId)` — just changes the active ID (does NOT stop any process)
  - `closeConversation(conversationId)` — stops the process for that conversation (if running), removes tab, switches to adjacent
  - `renameConversation(id, label)` — allow custom tab names
- `sendMessage()` operates on `activeConversation`, passes `conversationId` to ClaudeService
- Route incoming Claude events by conversation ID to update the correct conversation's messages
- Store `claudeSessionId` from ClaudeService onto the conversation when received
- Persistence: delegated to ConversationStore

### 4. `src/renderer/components/chat/ChatWindow.tsx`

- Remove `endSession()` call on workspace unmount — processes survive navigation
- Add a tab bar between the header and the message list
- Each tab shows conversation label, close button (x)
- Tabs with a running Claude process show a spinner/indicator
- Tabs with pending tool approval show an attention badge
- "+" button at the end to create a new conversation
- Active tab highlighted with `--accent`
- Double-click tab label to rename
- Tab bar is horizontally scrollable if many tabs

### 5. `src/renderer/components/chat/ConversationTabs.tsx` (new file)

- Receives conversations list, active id, and callbacks (switch, close, new, rename)
- Renders the tab bar UI
- Handles double-click-to-rename with inline input

### 6. Persistence — `~/.config/overseer/conversations/{repo}/{id}.json`

- Each conversation is stored as an individual JSON file
- Directory structure: `~/.config/overseer/conversations/{repoName}/{conversationId}.json`
- File contents include all metadata and full message history:
  ```json
  {
    "id": "abc-123",
    "workspaceId": "wt-456",
    "label": "Conv 1",
    "claudeSessionId": "session-789",
    "createdAt": "2025-01-15T10:30:00Z",
    "messages": [...]
  }
  ```
- On startup, scan the repo directory to discover all conversations for a workspace
- Save after every message and on session end
- Deleting a tab deletes the file
- Add `~/.config/overseer/conversations/**` to the FS scope in `capabilities/default.json`

### 7. `src/renderer/stores/ConversationStore.ts` (new file)

- Dedicated store for conversation persistence using Tauri FS (same pattern as ConfigStore/RepoStore)
- `loadConversations(repoName: string): Promise<Conversation[]>` — reads all JSON files in the repo dir
- `saveConversation(repoName: string, conversation: Conversation): Promise<void>` — writes single file
- `deleteConversation(repoName: string, conversationId: string): Promise<void>` — removes file
- SessionStore delegates persistence to this store

## UI Sketch

```
┌─ feature/login ──────────────────── /path ────┐
│ [Conv 1] [Conv 2] [Conv 3]  [+]               │
├────────────────────────────────────────────────┤
│                                                │
│  messages for active conversation...           │
│                                                │
├────────────────────────────────────────────────┤
│  [input area]                          [Send]  │
└────────────────────────────────────────────────┘
```

## Edge Cases

- **Switching tabs/workspaces while Claude is running**: process keeps running in the background, events continue accumulating in that conversation's message history — when the user switches back, they see all the new messages
- **Visual indicator for running processes**: tabs with an active Claude process should show a spinner or pulsing dot so the user knows work is happening in the background
- **Resuming a conversation after process exits**: use `--resume {claudeSessionId}` to continue from where it left off
- **New conversation on same workspace**: starts fresh, no `--resume`
- **Closing a tab with a running process**: stop that specific process first, then remove
- **Closing the last tab**: create a new empty one automatically
- **Tab overflow**: horizontal scroll with fade indicators
- **App quit**: iterate all running processes and kill them cleanly
- **Memory**: many concurrent processes could use significant memory — not a concern for typical usage (2-5 concurrent) but worth noting
- **Tool approval while not viewing**: if a background conversation hits a tool approval prompt, show a notification or badge on the tab so the user knows it needs attention
- **Completion notification**: when a background Claude process exits (result event or process close), fire an OS-level notification via Tauri's notification API — e.g. "Overseer: Conv 1 finished" with the repo/conversation name. Also update the tab indicator from spinner to a checkmark/done state. Clicking the notification should switch to that conversation.

## Notifications

### Tauri integration

- Use `tauri-plugin-notification` for native OS notifications
- Add to `Cargo.toml`: `tauri-plugin-notification = "2"`
- Add to `lib.rs` plugin setup: `.plugin(tauri_plugin_notification::init())`
- Add `notification:default` to `capabilities/default.json`

### Frontend

- In `ClaudeService`, when a process exits (`claude:close:{conversationId}` event), check if that conversation is currently in view
- If **not in view**: fire a notification via `sendNotification()` from `@tauri-apps/plugin-notification`
  - Title: "Overseer"
  - Body: "{conversationLabel} in {repoName} finished"
- If **in view**: no OS notification needed, the user can already see it

### Tab state

- Track per-conversation status: `idle` | `running` | `done` | `needs_attention`
- `running` → spinner
- `done` → brief checkmark that fades after a few seconds when the tab is visible
- `needs_attention` → orange dot (tool approval pending)
