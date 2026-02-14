# Codex CLI & App Server

OpenAI Codex is a coding agent that runs locally from the terminal. The CLI is open-source (Apache-2.0), written in Rust, and can read, change, and run code on your machine. For GUI integrations, Codex exposes an **app-server** subcommand — a long-running JSON-RPC 2.0 process over stdio.

> Source: https://developers.openai.com/codex/app-server

## Quick Start

### Installation

```bash
# npm (recommended)
npm install -g @openai/codex

# Homebrew
brew install codex

# Or download a binary from the latest GitHub Release
# https://github.com/openai/codex/releases
```

### Authentication

```bash
codex login                # Browser-based ChatGPT OAuth flow
codex login --with-api-key # Read API key from stdin
codex login --device-auth  # Device-code flow (headless environments)
```

Three auth modes:

| Mode | Description |
|------|-------------|
| **API Key** (`apikey`) | Caller supplies an OpenAI API key |
| **ChatGPT managed** (`chatgpt`) | Codex owns the OAuth flow, persists & refreshes tokens |
| **ChatGPT external tokens** (`chatgptAuthTokens`) | Host app supplies `idToken` + `accessToken` directly |

Codex is included with ChatGPT Plus, Pro, Business, Edu, and Enterprise plans.

### Platform Support

- **macOS & Linux** — fully supported
- **Windows** — experimental (best via WSL)

## CLI Commands

### Interactive Mode

```bash
codex                           # Launch full-screen TUI
codex "Tell me about this project"  # Launch with initial prompt
codex --model gpt-5-codex      # Override model
codex -i screenshot.png "Fix this"  # Attach image
```

### Non-Interactive (`exec`)

```bash
codex exec "fix the CI failure"
codex exec --json "summarize changes"   # JSONL event output
codex exec -o result.md "write docs"    # Write final message to file
codex exec resume --last "continue"     # Resume previous session
```

### Session Management

```bash
codex resume              # Pick from recent sessions
codex resume --last       # Resume most recent
codex resume <SESSION_ID> # Resume specific session
codex fork --last         # Fork most recent session
```

### MCP Server Management

```bash
codex mcp add github -- npx -y @modelcontextprotocol/server-github
codex mcp add remote-api --url https://api.example.com/mcp
codex mcp list
codex mcp login <name>
codex mcp remove <name>
```

### Codex as MCP Server

```bash
codex mcp-server   # Run Codex itself as an MCP server over stdio
```

Exposes two tools: `codex` (start session) and `codex-reply` (continue session).

### App Server (for GUI clients)

```bash
codex app-server                      # Launch JSON-RPC server over stdio
codex app-server generate-ts --out ./schemas   # Generate TypeScript types
codex app-server generate-json-schema --out ./schemas  # Generate JSON Schema
```

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `--model, -m <string>` | Override configured model |
| `--sandbox, -s <policy>` | `read-only`, `workspace-write`, `danger-full-access` |
| `--ask-for-approval, -a <policy>` | `untrusted`, `on-failure`, `on-request`, `never` |
| `--full-auto` | Sets `--ask-for-approval on-request` + `--sandbox workspace-write` |
| `--yolo` | Bypass all approvals and sandboxing (dangerous) |
| `--add-dir <path>` | Grant write access to additional directories |
| `--cd, -C <path>` | Set working directory |
| `--image, -i <path>` | Attach image files |
| `--config, -c <key=value>` | Override configuration values |
| `--profile, -p <string>` | Configuration profile name |
| `--search` | Enable live web search |
| `--oss` | Use local open-source model provider (Ollama) |

## Approval Policies

| Policy | Behavior |
|--------|----------|
| `untrusted` | Approve every shell command and file change |
| `on-failure` | Auto-approve; pause only on non-zero exit |
| `on-request` | Auto-approve safe ops; pause for risky ones |
| `never` | Never pause for approval |

## Sandbox Policies

| Policy | Description |
|--------|-------------|
| `read-only` | No file writes or command execution |
| `workspace-write` | Write within workspace + `writableRoots` |
| `danger-full-access` | Unrestricted machine access |
| `externalSandbox` | Delegate to external sandbox provider |

## Configuration

Stored in `~/.codex/config.toml` (global) or `.codex/config.toml` (project-scoped).

---

## App Server Protocol

The app-server is the primary integration surface for building GUI clients. It uses **JSON-RPC 2.0 over stdio** with newline-delimited messages, but **omits the `"jsonrpc":"2.0"` header**.

### Message Types

| Type | Shape | Description |
|------|-------|-------------|
| **Request** | `{method, params, id}` | Client→server, expects response |
| **Response** | `{id, result}` or `{id, error}` | Server→client, matches request `id` |
| **Notification** | `{method, params}` | No `id`, no response expected |
| **Server Request** | `{method, params, id}` | Server→client, expects response (approvals) |

### Core Primitives

- **Thread** — a conversation between user and agent; contains turns
- **Turn** — a single user request and agent's work; contains items
- **Item** — a unit of input/output (messages, commands, file changes, tool calls)

### Initialization Flow

Every client must perform the initialize handshake before any other operations:

```
→ {"method":"initialize","id":0,"params":{"clientInfo":{"name":"my-app","title":"My App","version":"1.0.0"}}}
← {"id":0,"result":{"userAgent":"codex/0.1.0"}}
→ {"method":"initialized","params":{}}
```

The `clientInfo.name` field is required for compliance logging.

## Thread API

### `thread/start`

Creates a new conversation thread.

```json
→ {
  "method": "thread/start",
  "id": 1,
  "params": {
    "cwd": "/path/to/project",
    "model": "gpt-5.1-codex",
    "approvalPolicy": "untrusted",
    "sandbox": "workspaceWrite"
  }
}
← {
  "id": 1,
  "result": {
    "thread": {
      "id": "thr_abc123",
      "preview": "",
      "modelProvider": "...",
      "createdAt": "..."
    }
  }
}
```

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Model identifier (e.g., `"gpt-5.1-codex"`) |
| `cwd` | `string` | Working directory |
| `approvalPolicy` | `string` | `"never"`, `"unlessTrusted"` |
| `sandbox` | `string` | `"workspaceWrite"`, `"readOnly"`, `"dangerFullAccess"`, `"externalSandbox"` |
| `dynamicTools` | `array` | Optional dynamic tool definitions |

### `thread/resume`

Reopens an existing thread by ID.

```json
→ {"method":"thread/resume","id":2,"params":{"threadId":"thr_abc123"}}
```

### `thread/fork`

Branches a stored session into a new thread.

```json
→ {"method":"thread/fork","id":3,"params":{"threadId":"thr_abc123"}}
← {"id":3,"result":{"thread":{"id":"thr_def456",...}}}
```

### `thread/list`

Pages through stored threads with filtering.

| Field | Type | Description |
|-------|------|-------------|
| `cursor` | `string` | Pagination cursor |
| `limit` | `number` | Page size |
| `sortKey` | `string` | `"created_at"` or `"updated_at"` |
| `archived` | `boolean` | Filter by archived state |

### `thread/read`

Reads a stored thread without resuming it.

| Field | Type | Description |
|-------|------|-------------|
| `threadId` | `string` | Thread ID |
| `includeTurns` | `boolean` | Include full turn history |

### Other Thread Methods

| Method | Description |
|--------|-------------|
| `thread/loaded/list` | List thread IDs currently in memory |
| `thread/archive` | Move thread to archived directory |
| `thread/unarchive` | Restore archived thread |
| `thread/rollback` | Drop last N turns from context |
| `thread/compact` | Trigger context compaction |

## Turn API

### `turn/start`

Sends user input and begins agent generation.

```json
→ {
  "method": "turn/start",
  "id": 4,
  "params": {
    "threadId": "thr_abc123",
    "input": [{"type": "text", "text": "Fix the login bug"}],
    "cwd": "/path/to/project",
    "approvalPolicy": "untrusted",
    "sandboxPolicy": {
      "type": "workspaceWrite",
      "writableRoots": ["/path/to/project"],
      "networkAccess": true
    }
  }
}
← {"id":4,"result":{"turn":{"id":"turn_xyz","status":"inProgress","items":[],"error":null}}}
```

**Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `threadId` | `string` | Thread ID (required) |
| `input` | `array` | Content items (required) |
| `cwd` | `string` | Working directory override |
| `approvalPolicy` | `string` | Override approval policy |
| `sandboxPolicy` | `object` | Sandbox configuration |
| `model` | `string` | Override model for this turn |
| `effort` | `string` | `"low"`, `"medium"`, `"high"` |
| `summary` | `string` | `"concise"`, `"detailed"` |
| `outputSchema` | `object` | JSON Schema for structured response |
| `dynamicTools` | `array` | Dynamic tool definitions |

**Input item types:**

| Type | Fields | Description |
|------|--------|-------------|
| `text` | `text: string` | Text message |
| `image` | `url: string` | Remote image URL |
| `localImage` | `path: string` | Local image file path |
| `skill` | `name, path` | Attach a skill |
| `mention` | `name, path` | File or app mention |

### `turn/interrupt`

Cancels an in-flight turn. The turn finishes with `status: "interrupted"`.

```json
→ {"method":"turn/interrupt","params":{"threadId":"thr_abc123","turnId":"turn_xyz"}}
```

Note: This is a **notification** (no `id`), not a request.

## Streaming Events

The server emits notifications as the agent works. These are the primary events for building a real-time UI.

### Turn Lifecycle

| Event | Payload | Description |
|-------|---------|-------------|
| `turn/started` | `{turn}` | Turn begins, empty items |
| `turn/completed` | `{turn}` | Turn finishes with final status |
| `turn/diff/updated` | `{threadId, turnId, diff}` | Aggregated unified diff |
| `turn/plan/updated` | `{turnId, plan: [{step, status}]}` | Plan progress |

**Turn completion statuses:** `completed`, `interrupted`, `failed`

### Item Lifecycle

| Event | Payload | Description |
|-------|---------|-------------|
| `item/started` | `{item}` | Item begins |
| `item/completed` | `{item}` | Item finishes (authoritative state) |

### Text Streaming Deltas

| Event | Payload |
|-------|---------|
| `item/agentMessage/delta` | `{itemId, text}` |
| `item/plan/delta` | `{itemId, text}` |
| `item/reasoning/summaryTextDelta` | `{itemId, text, summaryIndex}` |
| `item/reasoning/textDelta` | `{itemId, text}` |
| `item/commandExecution/outputDelta` | `{itemId, output}` |
| `item/fileChange/outputDelta` | Tool call response data |

### Informational Notifications

| Event | Description |
|-------|-------------|
| `thread/name/updated` | Thread title changed |
| `thread/tokenUsage/updated` | Token usage stats |
| `thread/compacted` | Context was compacted |
| `account/updated` | Auth state changed |
| `account/rateLimits/updated` | Rate limits changed |
| `deprecationNotice` | Feature deprecation warning |
| `error` | Error notification with `{message}` |

## Item Types

Items represent the units of work within a turn:

| Type | Key Fields | Description |
|------|------------|-------------|
| `userMessage` | `content: [inputs]` | User's input |
| `agentMessage` | `text: string` | Agent's text response |
| `plan` | `text: string` | Agent's plan |
| `reasoning` | `summary, content` | Agent's reasoning |
| `commandExecution` | `command, cwd, status, exitCode, durationMs` | Shell command |
| `fileChange` | `changes: [{path, kind, diff}], status` | File modification |
| `mcpToolCall` | `server, tool, arguments, result, error, status` | MCP tool invocation |
| `webSearch` | `query, action` | Web search |
| `imageView` | `path` | Image reference |
| `contextCompaction` | — | Context was compacted |

**Item statuses:** `completed`, `failed`, `declined` (for approved items), `inProgress`

## Approval Flow

When approval policy requires it, the server sends server-initiated requests (with `id`) that the client must respond to.

### Command Execution Approval

```
← {"method":"item/commandExecution/requestApproval","id":100,"params":{
     "itemId":"item_1","threadId":"thr_abc123","turnId":"turn_xyz",
     "reason":"Runs an external command","risk":"medium",
     "parsedCmd":{"command":"npm test","args":[]}
   }}

→ {"id":100,"result":{"decision":"accept"}}
```

**Decision values:** `"accept"`, `"decline"`, `"cancel"`

The response may include `acceptSettings` for command approvals.

### File Change Approval

```
← {"method":"item/fileChange/requestApproval","id":101,"params":{
     "itemId":"item_2","threadId":"thr_abc123","turnId":"turn_xyz",
     "reason":"Modifies source file"
   }}

→ {"id":101,"result":{"decision":"accept"}}
```

### User Input Request

```
← {"method":"item/tool/requestUserInput","id":102,"params":{
     "questions":[{"text":"Which database?"}],
     "threadId":"thr_abc123","turnId":"turn_xyz"
   }}

→ {"id":102,"result":{"answers":["PostgreSQL"]}}
```

## Authentication API

### `account/read`

```json
→ {"method":"account/read","id":10,"params":{"refreshToken":false}}
← {"id":10,"result":{"account":{"type":"chatgpt","email":"user@example.com","planType":"plus"},"requiresOpenaiAuth":false}}
```

### `account/login/start`

**API Key:**
```json
→ {"method":"account/login/start","id":11,"params":{"type":"apiKey","apiKey":"sk-..."}}
← {"id":11,"result":{"type":"apiKey"}}
```

**ChatGPT OAuth:**
```json
→ {"method":"account/login/start","id":12,"params":{"type":"chatgpt"}}
← {"id":12,"result":{"type":"chatgpt","loginId":"uuid","authUrl":"https://..."}}
```

**External Tokens:**
```json
→ {"method":"account/login/start","id":13,"params":{"type":"chatgptAuthTokens","idToken":"jwt","accessToken":"jwt"}}
← {"id":13,"result":{"type":"chatgptAuthTokens"}}
```

### `account/login/cancel`

Cancels a pending ChatGPT login by `loginId`.

### `account/logout`

Signs out the current user. Emits `account/updated` with `authMode: null`.

### `account/chatgptAuthTokens/refresh`

Server-initiated request for fresh tokens (external token mode). Times out after ~10 seconds.

```
← {"method":"account/chatgptAuthTokens/refresh","id":200,"params":{"reason":"token_expired","previousAccountId":"..."}}
→ {"id":200,"result":{"idToken":"new_jwt","accessToken":"new_jwt"}}
```

### `account/rateLimits/read`

```json
← {"id":14,"result":{"rateLimits":{"primary":{"usedPercent":42,"windowDurationMins":180,"resetsAt":1700000000}}}}
```

## Review API

### `review/start`

Launches the Codex reviewer on a thread.

```json
→ {"method":"review/start","id":20,"params":{
     "threadId":"thr_abc123",
     "delivery":"inline",
     "target":{"type":"uncommittedChanges"}
   }}
```

**Target types:**

| Type | Description |
|------|-------------|
| `uncommittedChanges` | Review staged/unstaged/untracked changes |
| `baseBranch` | Review against merge base |
| `commit` | Review specific commit by SHA |
| `custom` | Custom review instructions |

## Command Execution API

### `command/exec`

Runs a single command under the server's sandbox.

```json
→ {"method":"command/exec","id":30,"params":{
     "command":["npm","test"],
     "cwd":"/path/to/project",
     "sandboxPolicy":{"type":"workspaceWrite","writableRoots":["/path/to/project"]},
     "timeoutMs":30000
   }}
← {"id":30,"result":{"exitCode":0,"stdout":"...","stderr":"..."}}
```

## Skills API

### `skills/list`

```json
→ {"method":"skills/list","id":40,"params":{"cwds":["/path/to/project"]}}
← {"id":40,"result":{"data":[{"cwd":"/path/to/project","skills":[{"name":"review","description":"Code review skill","enabled":true}],"errors":[]}]}}
```

### `skills/config/write`

Enable or disable a skill by path.

## Config API

| Method | Description |
|--------|-------------|
| `config/read` | Read effective configuration |
| `config/value/write` | Write single key/value to `config.toml` |
| `config/batchWrite` | Atomic batch config update |
| `configRequirements/read` | Read `requirements.toml` and MDM settings |

## MCP Server Operations

| Method | Description |
|--------|-------------|
| `mcpServer/oauth/login` | Start OAuth login for MCP server |
| `config/mcpServer/reload` | Reload MCP configuration |
| `mcpServerStatus/list` | List servers, tools, resources, auth status |

## Model API

| Method | Description |
|--------|-------------|
| `model/list` | List available models with capabilities |
| `collaborationMode/list` | List collaboration presets (experimental) |

## Error Handling

### Error Response

```json
← {"id":5,"error":{"code":-32600,"message":"Invalid request"}}
```

### Turn Failure

Turns can end with `status: "failed"` and structured error info:

```json
{
  "turn": {
    "status": "failed",
    "error": {
      "message": "Context window exceeded",
      "codexErrorInfo": "ContextWindowExceeded"
    }
  }
}
```

**Common `codexErrorInfo` values:**

| Error | Description |
|-------|-------------|
| `ContextWindowExceeded` | Token limit hit |
| `UsageLimitExceeded` | Rate/usage limit |
| `HttpConnectionFailed` | Upstream connection error (includes `httpStatusCode`) |
| `ResponseStreamConnectionFailed` | Stream connection lost |
| `ResponseStreamDisconnected` | Stream interrupted |
| `ResponseTooManyFailedAttempts` | Retry limit exhausted |
| `BadRequest` | Invalid request parameters |
| `Unauthorized` | Authentication failure |
| `SandboxError` | Sandbox policy violation |
| `InternalServerError` | Server-side error |

## Codex as MCP Server

When run as `codex mcp-server`, Codex exposes two MCP tools for use by other agents:

### `codex` Tool

Start a new Codex session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string` | User instruction (required) |
| `approval-policy` | `string` | `"untrusted"`, `"on-request"`, `"on-failure"`, `"never"` |
| `sandbox` | `string` | `"read-only"`, `"workspace-write"`, `"danger-full-access"` |
| `model` | `string` | Model override |
| `config` | `object` | Settings overriding `config.toml` |
| `base-instructions` | `string` | Custom system instructions |

### `codex-reply` Tool

Continue an existing session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string` | Follow-up message (required) |
| `threadId` | `string` | Session ID from previous call (required) |

## MCP Client Configuration

Codex connects to MCP servers configured in `~/.codex/config.toml`:

```toml
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "$GITHUB_TOKEN" }

[mcp_servers.remote]
url = "https://api.example.com/mcp"
bearer_token_env_var = "API_TOKEN"
```

**Transport types:**

| Type | Config | Description |
|------|--------|-------------|
| **STDIO** | `command`, `args`, `env`, `cwd` | Local process over stdin/stdout |
| **Streamable HTTP** | `url`, `bearer_token_env_var` | Remote server over HTTP/SSE |

**Server options:**

| Field | Default | Description |
|-------|---------|-------------|
| `startup_timeout_sec` | `10` | Server startup timeout |
| `tool_timeout_sec` | `60` | Tool execution timeout |
| `enabled` | `true` | Enable/disable server |
| `enabled_tools` | all | Allowlist of tool names |
| `disabled_tools` | none | Blocklist of tool names |

## Schema Generation

Generate version-matched type definitions from your installed Codex binary:

```bash
codex app-server generate-ts --out ./schemas     # TypeScript interfaces
codex app-server generate-json-schema --out ./schemas  # JSON Schema bundle
```

Each output is specific to the Codex version you have installed.

## Links

- GitHub: [openai/codex](https://github.com/openai/codex)
- [App Server docs](https://developers.openai.com/codex/app-server)
- [CLI reference](https://developers.openai.com/codex/cli/reference/)
- [CLI features](https://developers.openai.com/codex/cli/features/)
- [MCP configuration](https://developers.openai.com/codex/mcp/)
- [Agents SDK integration](https://developers.openai.com/codex/guides/agents-sdk/)
- [Changelog](https://developers.openai.com/codex/changelog/)
- [Architecture blog post](https://openai.com/index/unlocking-the-codex-harness/)
