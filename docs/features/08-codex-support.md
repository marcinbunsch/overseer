# 08 — Codex Support

## Goal

Add Codex CLI support to Overseer by introducing an **AgentService** abstraction that hides protocol differences between Claude and Codex behind a unified API. The ChatStore should be agent-agnostic — it calls `agentService.sendMessage(...)`, not `claudeService.sendMessage(...)`.

---

## Research Summary

### Codex CLI: `codex app-server`

Codex uses a **long-running JSON-RPC server over stdio** (the `codex app-server` subcommand). This is fundamentally different from Claude CLI, which spawns a new process per conversation.

| Aspect          | Claude CLI                                   | Codex `app-server`                                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------ |
| Binary          | `claude`                                     | `codex app-server`                                     |
| Protocol        | Stream-JSON (custom)                         | JSON-RPC 2.0 over stdio (no `jsonrpc` header)          |
| Lifecycle       | One process per chat                         | Long-running; multiple threads per process             |
| Session start   | CLI flags + prompt via stdin                 | `initialize` handshake → `thread/start` → `turn/start` |
| Follow-ups      | `{ type: "user", message: {...} }` via stdin | `turn/start` request with `threadId`                   |
| Text streaming  | `content_block_delta` events                 | `item/agentMessage/delta` notifications                |
| Turn complete   | `result` event                               | `turn/completed` notification                          |
| Tool approval   | `control_request`/`control_response`         | Server-initiated request → client response by `id`     |
| Session resume  | `--resume {sessionId}` flag                  | `thread/resume` request with `threadId`                |
| Session ID      | `session_id` field in events                 | `threadId` from `thread/start` response                |
| Type generation | N/A                                          | `codex app-server generate-ts`                         |

### Key Protocol Details

**Initialization handshake** (required before any thread ops):

```json
→ {"method":"initialize","id":0,"params":{"clientInfo":{"name":"overseer","title":"Overseer","version":"1.0.0"}}}
← {"id":0,"result":{...}}
→ {"method":"initialized","params":{}}
```

**Starting a thread:**

```json
→ {"method":"thread/start","id":1,"params":{"cwd":"/path","approvalPolicy":"untrusted","sandbox":"workspace-write"}}
← {"id":1,"result":{"thread":{"id":"thr_123",...}}}
```

**Sending a message (turn):**

```json
→ {"method":"turn/start","id":2,"params":{"threadId":"thr_123","input":[{"type":"text","text":"..."}]}}
```

**Streaming events (server → client notifications):**

- `item/agentMessage/delta` — text streaming
- `item/started` / `item/completed` — tool execution lifecycle
- `turn/completed` — turn finalization
- `item/commandExecution/requestApproval` — command approval (server request with `id`)
- `item/fileChange/requestApproval` — file change approval (server request with `id`)

**Approval response:**

```json
→ {"id":"req_1","result":{"decision":"accept"}}
```

Decision values: `"accept"`, `"acceptForSession"`, `"decline"`, `"cancel"`

---

## Architecture

### Layer 1: AgentService Interface (Frontend)

A common interface that both Claude and Codex services implement:

```typescript
type AgentEvent =
  | { kind: "text"; text: string } // Streaming text delta
  | { kind: "message"; content: string; toolMeta?: ToolMeta } // Full message block
  | {
      kind: "toolApproval"
      id: string
      name: string
      input: Record<string, unknown>
      displayInput: string
      commandPrefix?: string
    }
  | { kind: "question"; id: string; questions: QuestionItem[]; rawInput: Record<string, unknown> }
  | { kind: "sessionId"; sessionId: string } // Session/thread ID captured
  | { kind: "turnComplete" } // Turn finished
  | { kind: "done" } // Process/connection ended

interface AgentService {
  sendMessage(chatId: string, prompt: string, workingDir: string): Promise<void>
  sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    toolInput?: Record<string, unknown>
  ): Promise<void>
  stopChat(chatId: string): Promise<void>
  isRunning(chatId: string): boolean
  getSessionId(chatId: string): string | null
  setSessionId(chatId: string, sessionId: string | null): void
  removeChat(chatId: string): void
  onEvent(chatId: string, callback: (event: AgentEvent) => void): void
  onDone(chatId: string, callback: () => void): void
}
```

### Layer 2: ClaudeAgentService (refactored from current ClaudeService)

Wraps the existing Claude stream-json protocol. Translates Claude-specific events into `AgentEvent`:

| Claude Event                        | → AgentEvent                                                   |
| ----------------------------------- | -------------------------------------------------------------- |
| `assistant` with `text` block       | `{ kind: "message", content }`                                 |
| `assistant` with `tool_use` block   | `{ kind: "message", content: "[ToolName]\n{json}", toolMeta }` |
| `content_block_delta`               | `{ kind: "text", text }`                                       |
| `result`                            | `{ kind: "turnComplete" }`                                     |
| `control_request` (tool)            | `{ kind: "toolApproval", ... }`                                |
| `control_request` (AskUserQuestion) | `{ kind: "question", ... }`                                    |
| `session_id` captured               | `{ kind: "sessionId", sessionId }`                             |
| Process exit                        | `{ kind: "done" }`                                             |

Gets `claudePath` from `configStore.claudePath` internally.

### Layer 3: CodexAgentService (new)

Manages a Codex `app-server` process. One process per workspace (since threads are scoped to a cwd). Translates Codex JSON-RPC events into `AgentEvent`:

| Codex Event                             | → AgentEvent                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| `item/agentMessage/delta`               | `{ kind: "text", text }`                                   |
| `item/started` (commandExecution)       | `{ kind: "message", content: "[Bash]\n{command}" }`        |
| `item/started` (fileChange)             | `{ kind: "message", content: "[Edit]\n{diff}", toolMeta }` |
| `item/completed` (agentMessage)         | `{ kind: "message", content }`                             |
| `turn/completed`                        | `{ kind: "turnComplete" }`                                 |
| `item/commandExecution/requestApproval` | `{ kind: "toolApproval", ... }`                            |
| `item/fileChange/requestApproval`       | `{ kind: "toolApproval", ... }`                            |
| `thread/start` response                 | `{ kind: "sessionId", sessionId: threadId }`               |
| Process exit                            | `{ kind: "done" }`                                         |

Gets `codexPath` from `configStore.codexPath` internally.

### Layer 4: AgentRegistry

Simple factory/registry that returns the correct service based on agent type:

```typescript
type AgentType = "claude" | "codex"

const agentRegistry = {
  getService(agentType: AgentType): AgentService { ... }
}
```

---

## Implementation Steps

### Phase 1: Introduce AgentEvent and AgentService interface

1. **Create `src/renderer/services/types.ts`** — Define `AgentEvent`, `AgentService` interface, and `AgentType`
2. **Create `src/renderer/services/agentRegistry.ts`** — Registry that maps agent type → service instance

### Phase 2: Refactor ClaudeService → ClaudeAgentService

3. **Refactor `src/renderer/services/claude.ts`** — Implement `AgentService` interface. Move Claude-specific event parsing into this service. The service emits `AgentEvent` instead of `ClaudeStreamEvent`. It reads `configStore.claudePath` internally so callers don't pass it.
4. **Update `agentRegistry.ts`** — Register ClaudeAgentService as the `"claude"` provider

### Phase 3: Update ChatStore to be agent-agnostic

5. **Add `agentType` field to `Chat` type** — In `src/renderer/types/index.ts`, add `agentType: AgentType` to `Chat` and `ChatFile`. Default to `"claude"` for backward compatibility. Rename `claudeSessionId` → `agentSessionId`.
6. **Refactor `ChatStore`** — Replace all `claudeService` references with `agentRegistry.getService(this.chat.agentType)`. Replace `handleClaudeEvent` with `handleAgentEvent` that works with `AgentEvent` (much simpler since the service already did the translation). Move Claude-specific parsing logic (tool_use formatting, Edit toolMeta extraction, AskUserQuestion detection) into ClaudeAgentService.
7. **Update `SessionStore`** — When creating a new chat, accept an `agentType` parameter. Update `sendMessage` and related methods to not pass `claudePath`.
8. **Update persistence** — Rename `claudeSessionId` → `agentSessionId` in `ChatFile` with backward-compat reading (fall back to `claudeSessionId` if `agentSessionId` is missing in stored JSON).

### Phase 4: Rust backend — generalize process management

9. **Rename Rust commands** — Rename `start_claude`/`claude_stdin`/`stop_claude` to `start_agent`/`agent_stdin`/`stop_agent`. These are already generic (they spawn a process and pipe stdio). Update the event prefixes from `claude:stdout` → `agent:stdout`, etc. Update `ClaudeProcessMap` → `AgentProcessMap`, `ClaudeProcessEntry` → `AgentProcessEntry`.
10. **Update frontend Tauri invocations** — Update `invoke("start_claude",...)` → `invoke("start_agent",...)` etc. in ClaudeAgentService.

### Phase 5: Add Codex backend support

11. **Add `start_codex_server` Tauri command** — Spawns `codex app-server` as a long-running process. Performs the `initialize`/`initialized` handshake. Emits `codex:stdout:{id}` / `codex:close:{id}` events. Tracks process per workspace ID.
12. **Add `codex_stdin` / `stop_codex_server` Tauri commands** — For sending JSON-RPC messages and killing the server process.

### Phase 6: CodexAgentService (Frontend)

13. **Create `src/renderer/services/codex.ts`** — Implements `AgentService`. On first `sendMessage`, starts the codex server process (if not running) and creates a thread. Maps `chatId` → `threadId`. Translates JSON-RPC notifications into `AgentEvent`. Handles the approval server-requests by responding with `decision` payloads.
14. **Register in agentRegistry** — Add `"codex"` provider

### Phase 7: Config and UI

15. **Add `codexPath` to ConfigStore** — Similar to `claudePath`, with default `$HOME/.local/bin/codex` and fallback `codex`.
16. **Add agent selector to new-chat UI** — When creating a new chat, let the user pick between Claude and Codex. Store the choice on the `Chat` object. Show the agent type on the chat tab.
17. **Update `ChatInput` placeholder** — Show "Ask Claude..." or "Ask Codex..." based on active chat's agent type.

### Phase 8: Tool display mapping

18. **Map Codex item types to tool display** — Codex uses `commandExecution`, `fileChange`, etc. instead of Claude's `Bash`, `Edit`, `Write`. The CodexAgentService should map these to equivalent display names so the existing tool rendering components work. For example:
    - `commandExecution` → renders as `[Bash]` with the command
    - `fileChange` → renders as `[Edit]` with the diff
    - `mcpToolCall` → renders as `[ToolName]` with the arguments

---

## File Changes Summary

| File                                         | Change                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/renderer/services/types.ts`             | **New** — AgentEvent, AgentService interface, AgentType            |
| `src/renderer/services/agentRegistry.ts`     | **New** — Registry mapping agent type → service                    |
| `src/renderer/services/claude.ts`            | **Modify** — Implement AgentService, internalize event translation |
| `src/renderer/services/codex.ts`             | **New** — CodexAgentService implementation                         |
| `src/renderer/stores/ChatStore.ts`           | **Modify** — Use AgentService instead of ClaudeService directly    |
| `src/renderer/stores/SessionStore.ts`        | **Modify** — Accept agentType, remove claudePath passing           |
| `src/renderer/stores/ConfigStore.ts`         | **Modify** — Add codexPath                                         |
| `src/renderer/types/index.ts`                | **Modify** — Add agentType to Chat, rename claudeSessionId         |
| `src-tauri/src/lib.rs`                       | **Modify** — Rename commands, add codex server commands            |
| `src/renderer/components/chat/ChatInput.tsx` | **Modify** — Dynamic placeholder                                   |
| `src/renderer/components/chat/ChatTabs.tsx`  | **Modify** — Show agent type indicator                             |
| UI for new chat                              | **Modify** — Agent selector                                        |

---

## Key Design Decisions

1. **One Codex app-server per workspace** — Since threads are scoped to a `cwd`, we spawn one server per workspace and create threads within it. This avoids re-doing the initialization handshake for every chat.

2. **AgentEvent as the boundary** — The ChatStore never sees raw Claude or Codex events. All protocol translation happens inside the respective service. This means adding a third agent (e.g., OpenCode) would only require a new service implementation.

3. **Backward-compatible persistence** — Old chats without `agentType` default to `"claude"`. The `claudeSessionId` field is read as `agentSessionId` during migration.

4. **Rust backend stays generic for Claude** — The existing `start_agent`/`agent_stdin`/`stop_agent` commands work for Claude since it's a simple spawn+stdio pattern. Codex needs its own commands because the app-server has a different lifecycle (long-running, shared across chats).

5. **Tool name mapping in CodexAgentService** — Codex item types (`commandExecution`, `fileChange`) are mapped to Claude-equivalent tool names (`Bash`, `Edit`) so the existing UI tool rendering components work without changes.

---

## Risks & Considerations

- **Codex app-server stability** — The app-server protocol is relatively new (v0.93.0). Breaking changes are possible. The generated TypeScript types (`codex app-server generate-ts`) should be used to stay in sync.
- **Approval flow differences** — Codex separates command approvals from file change approvals. The AgentEvent `toolApproval` kind needs to handle both. The `"acceptForSession"` decision in Codex maps to the existing "Approve All" pattern.
- **Long-running process management** — The Codex server process must be properly cleaned up when workspaces are closed or the app quits. Need to track which workspaces have active servers.
- **JSON-RPC request ID tracking** — Codex uses request IDs for both client→server requests and server→client requests. The service needs a counter for outgoing IDs and must match incoming server requests by their `id` for approval responses.
