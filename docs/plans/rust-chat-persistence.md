# Plan: Rust-side Chat Persistence with JSONL

## Goal

Move chat message persistence from TypeScript to Rust. When agent events arrive, Rust persists them to disk AND emits them to the frontend. The frontend becomes a pure view layer for chat messages.

## Key Design Decision: JSONL Format

Messages are immutable and append-only, making JSONL ideal:

```
{chat-id}.jsonl
```

Each line is a JSON object representing one message:
```jsonl
{"id":"msg-1","role":"user","content":"Hello","timestamp":"2026-02-16T10:00:00Z"}
{"id":"msg-2","role":"assistant","content":"Hi there!","timestamp":"2026-02-16T10:00:01Z"}
{"id":"msg-3","role":"assistant","content":"[Bash]\n{\"command\":\"ls\"}","timestamp":"2026-02-16T10:00:02Z","toolMeta":{"toolName":"Bash"}}
```

Benefits:
- **Append-only writes** - No need to read/parse/rewrite entire file
- **Crash-safe** - Partial writes only lose the last message
- **Streamable** - Can read line-by-line for large chats
- **Debuggable** - Easy to inspect with `cat` or `tail -f`

## File Structure Change

Current:
```
~/.config/overseer/chats/{project}/{workspace}/
├── {chat-id}.json      # Full chat with all messages
├── chats.json          # Index
└── workspace.json      # State
```

New:
```
~/.config/overseer/chats/{project}/{workspace}/
├── {chat-id}.meta.json # Chat metadata (id, label, agentType, etc.)
├── {chat-id}.jsonl     # Messages only (append-only)
├── chats.json          # Index (unchanged)
└── workspace.json      # State (unchanged)
```

## Architecture

### 1. Chat Session Manager (New Tauri Managed State)

```rust
pub struct ChatSessionManager {
    /// Active chat sessions: chat_id -> ChatSession
    sessions: Mutex<HashMap<String, ChatSession>>,
    config_dir: Mutex<Option<PathBuf>>,
}

struct ChatSession {
    chat_id: String,
    project_name: String,
    workspace_name: String,
    /// Buffered events waiting to be flushed
    pending_events: Vec<AgentEvent>,
    /// File handle for append (kept open during session)
    file_handle: Option<File>,
    /// Last flush time for debouncing
    last_flush: Instant,
}
```

### 2. New Tauri Commands

```rust
/// Register a chat session for persistence
#[tauri::command]
fn register_chat_session(
    chat_id: String,
    project_name: String,
    workspace_name: String,
    metadata: ChatMetadata,  // label, agentType, etc.
) -> Result<(), String>

/// Unregister and flush a chat session
#[tauri::command]
fn unregister_chat_session(chat_id: String) -> Result<(), String>

/// Append an event to a chat (called from agent event handlers)
#[tauri::command]
fn append_chat_event(
    chat_id: String,
    event: AgentEvent,
) -> Result<(), String>

/// Load all events from a chat (for initial load)
#[tauri::command]
fn load_chat_events(
    project_name: String,
    workspace_name: String,
    chat_id: String,
) -> Result<Vec<AgentEvent>, String>
```

### 3. Agent Handler Changes

Modify `start_agent` to accept chat context:

```rust
#[tauri::command]
pub fn start_agent(
    // ... existing params ...
    chat_id: String,           // NEW
    project_name: String,      // Already exists
    workspace_name: String,    // NEW
) -> Result<(), String>
```

In the event loop, persist and emit:

```rust
for event in parsed_events {
    // Persist the event directly to JSONL
    chat_manager.append_event(&chat_id, &event);

    // Emit to frontend (unchanged)
    let _ = app.emit(&format!("agent:event:{}", conv_id), event);
}
```

### 4. What Gets Stored

We store `AgentEvent` directly - no conversion. The JSONL file becomes a log of all events:

```jsonl
{"kind":"message","content":"I'll help you with that.","toolMeta":null}
{"kind":"toolApproval","requestId":"req-1","name":"Bash","input":{"command":"ls"},"displayInput":"ls","autoApproved":true}
{"kind":"bashOutput","text":"file1.txt\nfile2.txt\n"}
{"kind":"message","content":"Here are the files.","toolMeta":{"toolName":"Bash"}}
{"kind":"turnComplete"}
```

The frontend reconstructs the UI state from these events on load, just like it does during live streaming.

### 5. Event Replay Behavior (Critical)

Events that trigger prompts (ToolApproval, Question, PlanApproval) should only show prompts during live streaming, not when loading from disk.

**Solution: Mark as processed when storing**

When writing events to JSONL, add `isProcessed: true` to prompt-triggering events:

```rust
fn append_event(&mut self, event: &AgentEvent) {
    // Mark prompt-triggering events as processed before storing
    let event_to_store = match event {
        AgentEvent::ToolApproval { .. } |
        AgentEvent::Question { .. } |
        AgentEvent::PlanApproval { .. } => {
            // Clone and add isProcessed flag
            let mut json = serde_json::to_value(event).unwrap();
            json["isProcessed"] = serde_json::Value::Bool(true);
            json
        }
        _ => serde_json::to_value(event).unwrap()
    };

    writeln!(file, "{}", event_to_store)?;
}
```

**JSONL on disk:**
```jsonl
{"kind":"toolApproval","requestId":"req-1","name":"Bash","input":{"command":"ls"},"isProcessed":true}
{"kind":"question","requestId":"req-2","questions":[...],"isProcessed":true}
{"kind":"message","content":"Done!"}
```

**Frontend handling:**

```typescript
// In handleEvent()
handleEvent(event: AgentEvent) {
    switch (event.kind) {
        case "toolApproval":
            if (!event.isProcessed) {
                this.pendingToolUses.push({ ... });
            }
            // Always add to messages for display
            break;
        case "question":
            if (!event.isProcessed) {
                this.pendingQuestions.push({ ... });
            }
            break;
        // ...
    }
}
```

This approach:
- No special "replay mode" needed on load
- Events on disk are self-describing
- Frontend logic is simpler - just check `isProcessed`
- Live events don't have `isProcessed`, so they trigger prompts

### 6. Debounced Flushing

```rust
impl ChatSession {
    fn should_flush(&self) -> bool {
        self.pending_events.len() >= 10 ||
        self.last_flush.elapsed() > Duration::from_secs(2)
    }

    fn flush(&mut self) -> Result<(), Error> {
        if self.pending_events.is_empty() {
            return Ok(());
        }

        let file = self.file_handle.get_or_insert_with(|| {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.jsonl_path)
                .unwrap()
        });

        for event in self.pending_events.drain(..) {
            let line = serde_json::to_string(&event)?;
            writeln!(file, "{}", line)?;
        }
        file.sync_all()?;
        self.last_flush = Instant::now();
        Ok(())
    }
}
```

### 7. User Message Handling

When user sends a message, frontend calls:

```rust
#[tauri::command]
fn add_user_message(
    chat_id: String,
    content: String,
) -> Result<Message, String>
```

This creates the Message with ID/timestamp in Rust and persists it.

## Migration Path

### Phase 1: Add JSONL Support (Backward Compatible)

1. Add JSONL read/write functions to `overseer-core/persistence`
2. Add `ChatSessionManager` to Tauri
3. Add new commands for JSONL operations
4. Keep existing JSON format working

### Phase 2: Wire Up Agent Handlers

1. Modify `start_agent` commands to accept chat context
2. Add message persistence in event loops
3. Frontend calls `register_chat_session` before starting agent
4. Frontend calls `unregister_chat_session` when chat closes

### Phase 3: Update Frontend

1. Remove `scheduleSave()` calls from ChatStore
2. Remove `saveToDisk()` method
3. `loadFromDisk()` uses new `load_chat_messages` command
4. User messages go through `add_user_message` command

### Phase 4: Migrate Existing Data

1. On first load, if `.json` exists but `.jsonl` doesn't, migrate
2. Extract messages from JSON, write to JSONL
3. Write metadata to `.meta.json`
4. Keep old `.json` for safety (can delete later)

## Frontend Changes Summary

**ChatStore.ts changes:**

```typescript
// Before: Frontend manages persistence
this.scheduleSave()  // Called throughout

// After: Frontend just displays
// No save calls - Rust handles it
```

**AgentService changes:**

```typescript
// Before
await backend.invoke("start_agent", { conversationId, ... })

// After
await backend.invoke("start_agent", {
    conversationId,
    chatId: this.chat.id,
    projectName: this.context.getProjectName(),
    workspaceName: this.context.getWorkspaceName(),
    ...
})
```

## Open Questions

1. **Chat metadata updates** - How to handle label changes (from OverseerAction)?
   - Option A: Separate `update_chat_metadata` command
   - Option B: Append special "metadata" message type to JSONL

2. **Message deduplication** - If Rust emits and persists, frontend might try to add too
   - Solution: Frontend never creates messages, only receives them from Rust events

3. **Offline/reconnect** - If app restarts mid-chat, how to resume?
   - Load from JSONL, reconnect to agent with session_id

## Files to Modify

**Rust (overseer-core):**
- `persistence/mod.rs` - Add JSONL module
- `persistence/chat_jsonl.rs` - NEW: JSONL read/write
- `persistence/types.rs` - Add ChatMetadata type

**Rust (src-tauri):**
- `lib.rs` - Register ChatSessionManager, new commands
- `agents/claude.rs` - Add chat context, persist events
- `agents/codex.rs` - Same
- `agents/copilot.rs` - Same
- `agents/gemini.rs` - Same
- `agents/opencode.rs` - Same
- `chat_session.rs` - NEW: ChatSessionManager implementation

**TypeScript:**
- `stores/ChatStore.ts` - Remove save logic, use new commands
- `services/ClaudeService.ts` - Pass chat context to start_agent
- `services/CodexService.ts` - Same
- `services/CopilotService.ts` - Same
- `services/GeminiService.ts` - Same
- `services/OpenCodeService.ts` - Same
