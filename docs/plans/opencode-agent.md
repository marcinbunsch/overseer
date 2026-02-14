# OpenCode Agent Implementation Plan

Add OpenCode as the 5th agent in Overseer.

## Overview

OpenCode differs from existing agents by using an **HTTP server with SSE** instead of stdio-based communication. The architecture:

1. Rust backend spawns/kills the `opencode serve` process
2. Frontend makes HTTP requests directly to the server
3. Frontend connects to SSE endpoint for streaming events

This mirrors how OpenCode's own SDK works and avoids complex Rust HTTP client code.

---

## Files to Create

### 1. `src-tauri/src/agents/opencode.rs`

Rust backend for server lifecycle management.

**Key structures:**
```rust
struct OpenCodeServerEntry {
    child: Arc<Mutex<Option<Child>>>,
    port: u16,
    log_file: LogHandle,
}

pub struct OpenCodeServerMap {
    servers: Mutex<HashMap<String, OpenCodeServerEntry>>,
}
```

**Commands:**
- `start_opencode_server(server_id, opencode_path, port, log_dir, log_id)` - Spawns `opencode serve --port PORT`
- `stop_opencode_server(server_id)` - Kills server process
- `get_opencode_port(server_id)` - Returns port for HTTP requests

**Port allocation:** Start at 14096, increment if busy.

### 2. `src/renderer/services/opencode.ts`

Frontend AgentService implementation (~300 lines).

**Key structures:**
```typescript
interface OpenCodeChat {
  serverId: string
  sessionId: string | null
  port: number
  running: boolean
  workingDir: string
  eventSource: EventSource | null
}
```

**Implementation:**
- `sendMessage()`: Start server if needed → Create session → POST `/session/{id}/prompt_async` → Parse SSE events
- `sendToolApproval()`: No-op (use permissive config `"*": "allow"`)
- `stopChat()`: POST `/session/{id}/abort` → Close EventSource → Stop server
- SSE event translation to AgentEvent types

### 3. `src/renderer/services/__tests__/opencode.test.ts`

Unit tests following existing patterns.

---

## Files to Modify

### 4. `src-tauri/src/agents/mod.rs`

```rust
pub mod opencode;
pub use opencode::OpenCodeServerMap;
```

### 5. `src-tauri/src/lib.rs`

- Add `.manage(agents::OpenCodeServerMap::default())`
- Register commands in `invoke_handler`:
  - `agents::opencode::start_opencode_server`
  - `agents::opencode::stop_opencode_server`
  - `agents::opencode::get_opencode_port`

### 6. `src/renderer/services/types.ts`

```typescript
export type AgentType = "claude" | "codex" | "copilot" | "gemini" | "opencode"
```

### 7. `src/renderer/services/agentRegistry.ts`

```typescript
import { opencodeAgentService } from "./opencode"

const services: Record<AgentType, AgentService> = {
  // ... existing
  opencode: opencodeAgentService,
}
```

### 8. `src/renderer/stores/ConfigStore.ts`

Add:
- `opencodePath: string` observable (default: `"opencode"`)
- `opencodeModels: AgentModel[]` observable
- `defaultOpencodeModel: string | null` observable
- `setDefaultOpencodeModel()` action
- Update `Config` interface
- Update `DEFAULT_CONFIG`
- Update `getDefaultModelForAgent()` switch
- Update `load()` and `save()` methods

**Default models:**
```typescript
const DEFAULT_OPENCODE_MODELS: AgentModel[] = [
  { alias: "anthropic/claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
  { alias: "anthropic/claude-opus-4-5", displayName: "Claude Opus 4.5" },
  { alias: "openai/gpt-5.2", displayName: "GPT 5.2" },
  { alias: "google/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
]
```

### 9. `src/renderer/stores/ToolAvailabilityStore.ts`

Add:
- `@observable opencode: ToolStatus | null = null`
- `ensureOpencode()` method
- `recheckOpencode()` method
- Update `ToolName` type
- Update `invalidateAll()`

### 10. `src/renderer/components/chat/AgentIcon.tsx`

Add `OpenCodeIcon` component (terminal/code icon).

### 11. `src/renderer/components/chat/NewChatScreen.tsx`

Add OpenCode button to the agent selection grid.

### 12. `src/renderer/constants/agents.ts`

```typescript
export const AGENT_TITLES: Record<AgentType, string> = {
  // ... existing
  opencode: "OpenCode",
}
```

### 13. `src/renderer/components/shared/SettingsDialog.tsx`

Add OpenCode to:
- AGENTS array
- Default agent selector
- Default model selector
- CLI paths section

### 14. `src/renderer/components/chat/ModelSelector.tsx`

Ensure it handles `"opencode"` agent type.

---

## SSE Event Mapping

| OpenCode SSE Event | AgentEvent |
|-------------------|------------|
| `server.connected` | (ignore) |
| `session.created` | `{ kind: "sessionId", sessionId }` |
| `message.delta` | `{ kind: "text", text }` |
| `tool.started` | `{ kind: "message", content: "[ToolName]\n{json}", toolMeta }` |
| `tool.completed` | `{ kind: "bashOutput", text }` (for bash) |
| `session.completed` | `{ kind: "turnComplete" }` then `{ kind: "done" }` |

---

## Implementation Order

1. **Types** - Add "opencode" to AgentType (types.ts)
2. **Rust backend** - Server lifecycle (opencode.rs, mod.rs, lib.rs)
3. **ConfigStore** - Settings (opencodePath, models)
4. **ToolAvailabilityStore** - Availability check
5. **Frontend service** - Core AgentService implementation
6. **Agent registry** - Wire up service
7. **UI components** - Icon, NewChatScreen, SettingsDialog
8. **Tests** - Unit tests for service

---

## Verification

1. Run `pnpm checks` - ensure no lint/type errors
2. Run `pnpm test` - ensure all tests pass
3. Manual testing:
   - Install OpenCode CLI: `npm i -g opencode-ai@latest`
   - Configure provider: `opencode` then `/connect`
   - Launch Overseer dev: `pnpm dev`
   - Create new OpenCode chat
   - Send a message, verify streaming works
   - Stop generation, verify abort works
   - Verify tool calls render correctly
