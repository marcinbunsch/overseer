# Claude Agent Protocol Improvements

Improvements to Overseer's stream-json protocol handling for the Claude CLI.

## Overview

Overseer communicates with Claude via the local CLI using `--output-format stream-json --input-format stream-json --permission-prompt-tool stdio`. This approach avoids requiring an Anthropic API key and lets users keep their own auth/billing.

This document covers protocol handling improvements implemented to support additional Claude CLI features.

---

## Thinking Blocks

Models with extended thinking emit `thinking` content blocks in assistant messages. Overseer now handles these blocks and displays them as collapsible sections.

### Implementation

In `translateEvent` (`claude.ts`), thinking blocks are handled:

```typescript
if (block.type === "thinking" && block.thinking) {
  this.emitEvent(chatId, {
    kind: "message",
    content: block.thinking,
    toolMeta: { toolName: "Thinking", linesAdded: 0, linesRemoved: 0 },
  })
}
```

Using `toolMeta` with a synthetic "Thinking" tool name lets the existing `groupMessagesIntoTurns` logic treat it as a collapsible work message. The `TurnSection` component already collapses tool messages.

### Files

| File | Change |
|------|--------|
| `src/renderer/services/claude.ts` | Handle `thinking` blocks, added `thinking?: string` to content block type |

---

## Progressive Tool Display

During streaming, Claude emits `content_block_start` before a tool call completes. Overseer now uses this to show immediate visual feedback that a tool is starting.

### Implementation

Handling for `content_block_start` in `translateEvent`:

```typescript
if (event.type === "content_block_start" && event.content_block) {
  if (event.content_block.type === "tool_use" && event.content_block.name) {
    this.emitEvent(chatId, {
      kind: "text",
      text: `\n[${event.content_block.name}] ...`,
    })
  }
  return
}
```

This gives immediate visual feedback that a tool call is starting. The full details replace it when the `assistant` event arrives.

### Files

| File | Change |
|------|--------|
| `src/renderer/services/claude.ts` | Handle `content_block_start` in `translateEvent` |

---

## Configurable Permission Mode

Users can now configure the Claude permission mode (`default`, `acceptEdits`, `plan`) and Codex approval policy (`untrusted`, `full-auto`) via `ConfigStore`.

### Implementation

**Rust backend (`agent.rs`)**

Added `permission_mode: Option<String>` parameter to `start_agent`:

```rust
let mode = permission_mode.unwrap_or_else(|| "default".to_string());
```

**ConfigStore (`ConfigStore.ts`)**

Added permission mode settings for both Claude and Codex:

```typescript
export type ClaudePermissionMode = "default" | "acceptEdits" | "plan"
export type CodexApprovalPolicy = "untrusted" | "full-auto"

@observable claudePermissionMode: ClaudePermissionMode = "default"
@observable codexApprovalPolicy: CodexApprovalPolicy = "untrusted"
```

**ChatStore (`ChatStore.ts`)**

Passes the appropriate permission mode based on agent type:

```typescript
const permissionMode =
  this.chat.agentType === "claude"
    ? configStore.claudePermissionMode
    : this.chat.agentType === "codex"
      ? configStore.codexApprovalPolicy
      : null
```

### Files

| File | Change |
|------|--------|
| `src-tauri/src/agent.rs` | Add `permission_mode` param to `start_agent` |
| `src-tauri/Cargo.toml` | Add `libc` dependency for Unix |
| `src/renderer/services/claude.ts` | Accept and pass permission mode |
| `src/renderer/services/codex.ts` | Accept and use permission mode for `approvalPolicy` |
| `src/renderer/services/types.ts` | Update `AgentService` interface |
| `src/renderer/stores/ConfigStore.ts` | Add `claudePermissionMode` and `codexApprovalPolicy` settings |
| `src/renderer/stores/ChatStore.ts` | Pass permission mode to `sendMessage` |

### Config

Settings are persisted to `~/.config/overseer/config.json`:

```json
{
  "claudePermissionMode": "default",
  "codexApprovalPolicy": "untrusted"
}
```

---

## Graceful Interrupt

When stopping a Claude process, Overseer now sends SIGINT first to allow graceful shutdown, then falls back to force kill after 3 seconds.

### Implementation

Modified `stop_agent` in `agent.rs`:

```rust
#[cfg(unix)]
{
    let pid = child.id();
    unsafe {
        libc::kill(pid as i32, libc::SIGINT);
    }
    // Give the process up to 3 seconds to exit gracefully
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(100));
        match child.try_wait() {
            Ok(Some(_)) => {
                guard.take();
                return Ok(());
            }
            Ok(None) => continue,
            Err(_) => break,
        }
    }
}
// Force kill if still running (or on non-Unix platforms)
if let Some(mut child) = guard.take() {
    let _ = child.kill();
}
```

### Files

| File | Change |
|------|--------|
| `src-tauri/src/agent.rs` | Send SIGINT before kill in `stop_agent` |
| `src-tauri/Cargo.toml` | Add `libc = "0.2"` as Unix-only dependency |
