# 16 — Window Close Safety

## Goal

Ensure no chat data is lost when the user closes Overseer, and warn users if they're about to close while AI agents are still running.

---

## Features

### Chat Flush on Close

When the user closes the Overseer window, all pending chat saves are flushed to disk immediately. This ensures that any unsaved messages or chat state is persisted before the application exits.

### Running Chat Warning

If any chats are currently running (i.e., an agent is actively processing a message), Overseer displays a native confirmation dialog before closing:

- **Title**: "Quit Overseer?"
- **Message**: "There are chats still running. Quitting will stop them. Are you sure you want to quit?"
- **Kind**: Warning (shows a warning icon)
- **Buttons**: OK / Cancel

If the user clicks Cancel, the window close is prevented and they can continue using the app. If they click OK, all chats are flushed to disk and the window closes.

---

## Technical Implementation

### ProjectRegistry API

```typescript
class ProjectRegistry {
  /**
   * Check if any chats are currently running (sending messages).
   */
  hasRunningChats(): boolean

  /**
   * Flush all pending chat saves to disk immediately.
   * Called before window close to ensure no data is lost.
   */
  async flushAllChats(): Promise<void>
}
```

### Supporting Getters

To traverse from projects → workspaces → chats, two new getters were added:

```typescript
// ProjectStore
get workspaceStores(): WorkspaceStore[]

// WorkspaceStore
get allChats(): ChatStore[]
```

### Window Close Handler

The close handler is set up in `App.tsx` using Tauri's window API:

```typescript
const unlistenClose = getCurrentWindow().onCloseRequested(async (event) => {
  if (projectRegistry.hasRunningChats()) {
    const shouldClose = await confirm(
      "There are chats still running. Quitting will stop them. Are you sure you want to quit?",
      { title: "Quit Overseer?", kind: "warning" }
    )
    if (!shouldClose) {
      event.preventDefault()
      return
    }
  }
  await projectRegistry.flushAllChats()
})
```

---

## Chat Status Detection

A chat is considered "running" when its `chat.status` equals `"running"`. This status is set when:

- A user sends a message
- The agent is processing a response
- Tool calls are being executed

The status changes away from `"running"` when:

- The agent finishes responding
- An error occurs
- The user stops generation

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/App.tsx` | Added window close handler with confirmation dialog |
| `src/renderer/stores/ProjectRegistry.ts` | Added `hasRunningChats()` and `flushAllChats()` methods |
| `src/renderer/stores/ProjectStore.ts` | Added `workspaceStores` getter |
| `src/renderer/stores/WorkspaceStore.ts` | Added `allChats` getter |

---

## Dependencies

- `@tauri-apps/api/window` - For `getCurrentWindow().onCloseRequested()`
- `@tauri-apps/plugin-dialog` - For native `confirm()` dialog
