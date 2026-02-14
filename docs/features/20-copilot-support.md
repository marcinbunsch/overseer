# Implementation Plan: GitHub Copilot CLI Support

Add GitHub Copilot CLI as a third agent backend alongside Claude and Codex.

## Overview

Copilot CLI uses the Agent Client Protocol (ACP), which is JSON-RPC 2.0 over stdio - very similar to how Codex is implemented. The main differences are in method names and message structure.

**Protocol documentation:** [docs/copilot-cli.md](../copilot-cli.md)

## Implementation Steps

### Phase 1: Type Definitions

**File: `src/renderer/services/types.ts`**

Add `"copilot"` to the `AgentType` union:

```typescript
export type AgentType = "claude" | "codex" | "copilot"
```

---

### Phase 2: Configuration

**File: `src/renderer/stores/ConfigStore.ts`**

1. Add `copilotPath` field with default value `"copilot"`
2. Add to config persistence (load/save)

```typescript
@observable
copilotPath: string = "copilot"
```

**File: `src/renderer/stores/ToolAvailabilityStore.ts`**

Add `copilot` to availability tracking:

```typescript
@observable
copilot: ToolStatus | null = null
```

---

### Phase 3: Rust Backend

**File: `src-tauri/src/agent.rs`**

Add three new Tauri commands for Copilot process management:

#### 3.1 Data Structures

```rust
struct CopilotServerEntry {
    child: Child,
    stdin: ChildStdin,
    log_file: Option<File>,
}

type CopilotServerMap = Arc<Mutex<HashMap<String, CopilotServerEntry>>>;
```

#### 3.2 Commands

1. **`start_copilot_server`**
   - Spawn `copilot --acp --stdio`
   - Optional args: `--model <version>`
   - Set up stdout/stderr readers that emit events:
     - `copilot:stdout:{serverId}`
     - `copilot:stderr:{serverId}`
     - `copilot:close:{serverId}`
   - Optional logging to file

2. **`copilot_stdin`**
   - Write JSON-RPC message to Copilot process stdin
   - Parameters: `serverId`, `data`

3. **`stop_copilot_server`**
   - Graceful shutdown (SIGINT), then force kill after timeout
   - Clean up resources

---

### Phase 4: Frontend Service

**File: `src/renderer/services/copilot.ts`** (new file)

Implement `AgentService` interface using ACP protocol.

#### 4.1 State Management

```typescript
interface CopilotChat {
  serverId: string
  sessionId: string | null
  running: boolean
  buffer: string
  workingDir: string
  supportsLoadSession: boolean
  unlistenStdout: UnlistenFn | null
  unlistenClose: UnlistenFn | null
}
```

#### 4.2 Core Methods

| Method             | Implementation                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `sendMessage`      | Start server if needed → `initialize` → `session/new` or `session/load` → `session/prompt` |
| `sendToolApproval` | Respond to `session/request_permission` with selected option                               |
| `stopChat`         | Send `session/cancel`, then invoke `stop_copilot_server`                                   |
| `isRunning`        | Check `chat.running`                                                                       |
| `getSessionId`     | Return `chat.sessionId`                                                                    |
| `setSessionId`     | Set `chat.sessionId`                                                                       |
| `removeChat`       | Unlisten events, delete from map                                                           |
| `onEvent`          | Register callback                                                                          |
| `onDone`           | Register callback                                                                          |

#### 4.3 ACP Handshake

```typescript
async startServer(chatId: string, modelVersion?: string): Promise<void> {
  // 1. Spawn process via Tauri
  await invoke("start_copilot_server", {
    serverId: chat.serverId,
    copilotPath: configStore.copilotPath,
    modelVersion: modelVersion ?? null,
    logDir: logDir ?? null,
    logId: chatId,
  })

  // 2. Initialize
  const initResult = await this.sendRequest(chatId, "initialize", {
    protocolVersion: 1,
    clientInfo: { name: "overseer", title: "Overseer", version: "1.0.0" },
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true
    }
  })

  // 3. Store capabilities
  chat.supportsLoadSession = initResult.agentCapabilities?.loadSession ?? false
}
```

#### 4.4 Session Management

```typescript
async createOrLoadSession(chatId: string, workingDir: string): Promise<void> {
  const chat = this.chats.get(chatId)

  if (chat.sessionId && chat.supportsLoadSession) {
    // Try to load existing session
    await this.sendRequest(chatId, "session/load", {
      sessionId: chat.sessionId,
      cwd: workingDir,
      mcpServers: []
    })
  } else {
    // Create new session
    const result = await this.sendRequest(chatId, "session/new", {
      cwd: workingDir,
      mcpServers: []
    })
    chat.sessionId = result.sessionId
    this.emitEvent(chatId, { kind: "sessionId", sessionId: result.sessionId })
  }
}
```

#### 4.5 Event Translation

Map ACP `session/update` notifications to `AgentEvent`:

| ACP Update Type                        | AgentEvent                                                    |
| -------------------------------------- | ------------------------------------------------------------- |
| `agent_message_chunk`                  | `{ kind: "text", text }`                                      |
| `tool_call` (status: pending)          | `{ kind: "toolApproval", ... }` or `{ kind: "message", ... }` |
| `tool_call_update` (status: completed) | `{ kind: "message", ... }` with tool output                   |
| `plan`                                 | Could map to `{ kind: "message" }` with formatted plan        |

Map `session/request_permission` to `{ kind: "toolApproval" }`:

```typescript
handlePermissionRequest(chatId: string, req: JsonRpcServerRequest): void {
  const params = req.params
  const options = params.options as PermissionOption[]

  // Find the allow_once option to determine tool info
  const allowOption = options.find(o => o.kind === "allow_once")

  this.emitEvent(chatId, {
    kind: "toolApproval",
    id: String(req.id),
    name: params.title ?? "Permission",
    input: params,
    displayInput: params.description ?? JSON.stringify(params)
  })
}
```

#### 4.6 Approval Response

```typescript
async sendToolApproval(
  chatId: string,
  requestId: string,
  approved: boolean
): Promise<void> {
  const optionId = approved ? "allow_once" : "reject_once"
  const parsedId = /^\d+$/.test(requestId) ? Number(requestId) : requestId

  const response = JSON.stringify({
    id: parsedId,
    result: { selected: { optionId } }
  })

  await invoke("copilot_stdin", {
    serverId: chat.serverId,
    data: response
  })
}
```

#### 4.7 Turn Completion

Listen for the response to `session/prompt` which contains `stopReason`:

```typescript
// When we receive response to session/prompt
if (result.stopReason) {
  this.emitEvent(chatId, { kind: "turnComplete" })
}
```

---

### Phase 5: Service Registration

**File: `src/renderer/services/agentRegistry.ts`**

```typescript
import { copilotAgentService } from "./copilot"

const services: Record<AgentType, AgentService> = {
  claude: claudeAgentService,
  codex: codexAgentService,
  copilot: copilotAgentService,
}
```

---

### Phase 6: UI Integration

#### 6.1 Agent Selection

Update any UI that allows agent selection to include Copilot:

- Settings panel (agent path configuration)
- Chat creation (if agent selection is exposed)
- Workspace settings (if per-workspace agent config exists)

#### 6.2 Agent Path Configuration

Add input field for `copilotPath` in settings, similar to existing `claudePath` and `codexPath` fields.

#### 6.3 Tool Availability

Show Copilot availability status similar to Claude/Codex. If not found, show installation link:

- https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli

---

### Phase 7: Testing

**File: `src/renderer/services/__tests__/copilot.test.ts`** (new file)

Test cases (mirror claude.test.ts structure):

1. **Process lifecycle**
   - Start server on first message
   - Reuse server for follow-up messages
   - Stop server on stopChat

2. **ACP handshake**
   - Initialize with correct capabilities
   - Create session with cwd
   - Load session when supported

3. **Message flow**
   - Send prompt via session/prompt
   - Handle streaming updates
   - Detect turn completion

4. **Approvals**
   - Emit toolApproval for permission requests
   - Send correct response format

5. **Error handling**
   - Command not found
   - Auth required
   - Session errors

---

## File Summary

| File                                              | Action                                |
| ------------------------------------------------- | ------------------------------------- |
| `src/renderer/services/types.ts`                  | Modify - add "copilot" to AgentType   |
| `src/renderer/stores/ConfigStore.ts`              | Modify - add copilotPath              |
| `src/renderer/stores/ToolAvailabilityStore.ts`    | Modify - add copilot status           |
| `src-tauri/src/agent.rs`                          | Modify - add Copilot process commands |
| `src/renderer/services/copilot.ts`                | Create - ACP agent service            |
| `src/renderer/services/agentRegistry.ts`          | Modify - register copilot             |
| `src/renderer/services/__tests__/copilot.test.ts` | Create - tests                        |
| UI components (settings, etc.)                    | Modify - add Copilot options          |

## Risks & Considerations

1. **ACP is in public preview** - Protocol may change. Implement version checking and handle gracefully.

2. **Authentication** - Copilot requires GitHub auth. Detect auth errors and guide user to run `gh auth login`.

3. **Capability differences** - Some ACP features (images, audio, MCP) may not be fully supported initially. Start with text-only.

4. **Session loading** - Not all Copilot versions may support `loadSession`. Check capability before attempting.

5. **Permission options** - ACP has 4 permission kinds vs Codex's simple accept/decline. May need UI changes to support "always allow/deny".

## Future Enhancements

- Support for `allow_always` / `reject_always` permission preferences
- MCP server configuration
- Plan mode visualization
- Model selection UI
- Session mode switching
