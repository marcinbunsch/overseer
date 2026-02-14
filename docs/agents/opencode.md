# OpenCode

OpenCode is an open-source AI coding agent built for the terminal. Written in TypeScript (Bun runtime), it provides a TUI (Terminal User Interface) for interacting with 75+ AI providers to help with coding tasks, debugging, and more. For GUI integrations, OpenCode exposes a **headless HTTP server** with OpenAPI 3.1 and supports **ACP (Agent Client Protocol)** for IDE integration.

> Source: https://opencode.ai/docs/

## Quick Start

### Installation

```bash
# Install script (recommended)
curl -fsSL https://opencode.ai/install | bash

# npm
npm i -g opencode-ai@latest

# Homebrew (macOS/Linux)
brew install anomalyco/tap/opencode

# Windows
scoop install opencode
# or
choco install opencode

# Arch Linux
paru -S opencode-bin
```

### Authentication

```bash
# Interactive provider setup
opencode
# Then run /connect in the TUI

# Or use environment variables
export ANTHROPIC_API_KEY=your-api-key
export OPENAI_API_KEY=your-api-key
export GEMINI_API_KEY=your-api-key
```

Supports 75+ providers including:

| Provider | Auth Method |
|----------|-------------|
| **Anthropic** | OAuth (Claude Pro/Max) or API key |
| **OpenAI** | OAuth (ChatGPT Plus/Pro) or API key |
| **GitHub Copilot** | Device auth via github.com/login/device |
| **Google Vertex AI** | Service account or gcloud auth |
| **AWS Bedrock** | AWS credentials/IAM roles |
| **Groq** | API key |
| **Azure OpenAI** | API key + resource name |
| **Local (Ollama)** | No auth needed |

### Platform Support

- **macOS & Linux** — fully supported
- **Windows** — via Scoop, Chocolatey, or WSL

## CLI Commands

### Interactive Mode (TUI)

```bash
opencode                              # Launch TUI
opencode --continue                   # Resume last session
opencode --session <id>               # Resume specific session
opencode --model claude-sonnet-4-5    # Override model
opencode --agent plan                 # Start in plan mode
```

### Non-Interactive (`run`)

```bash
opencode run "fix the bug in auth.py"           # Single prompt, exits after
opencode run "summarize changes" -f json        # JSON output
opencode run "refactor module" -f stream-json   # Streaming JSON events
opencode run "continue" --session <id>          # Resume session
opencode -p "explain this code" -q              # Quiet mode (no spinner)
```

### Headless Server (`serve`)

```bash
opencode serve                        # Launch HTTP server on port 4096
opencode serve --port 8080            # Custom port
opencode serve --cors http://localhost:5173  # Enable CORS
```

### Other Commands

| Command | Description |
|---------|-------------|
| `opencode attach <url>` | Connect TUI to remote server |
| `opencode web` | Start server with browser UI |
| `opencode acp` | Start ACP server over stdio |
| `opencode agent list` | List available agents |
| `opencode auth login` | Manage provider credentials |
| `opencode mcp add <name>` | Add MCP server |
| `opencode mcp list` | List configured MCP servers |
| `opencode session list` | View all sessions |
| `opencode models` | Display available models |
| `opencode stats` | Token usage and cost analytics |

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `--prompt, -p <text>` | Non-interactive mode with direct prompt |
| `--continue, -c` | Resume last session |
| `--session, -s <id>` | Resume specific session |
| `--fork` | Fork existing session |
| `--model, -m <string>` | Override configured model |
| `--agent <name>` | Use specific agent (build, plan) |
| `--format, -f <format>` | Output format: `text`, `json`, `stream-json` |
| `--quiet, -q` | Suppress spinner animation |
| `--allowedTools <list>` | Comma-separated allowed tools |
| `--excludedTools <list>` | Comma-separated blocked tools |
| `--port <number>` | Server port (serve mode) |
| `--hostname <string>` | Server hostname |
| `--print-logs` | Output logs to stderr |
| `--log-level <level>` | DEBUG, INFO, WARN, ERROR |

## Built-in Agents

OpenCode includes switchable agents (toggle with Tab key):

| Agent | Description |
|-------|-------------|
| **build** | Full-access development agent (default) |
| **plan** | Read-only mode for analysis; denies edits, asks for bash approval |

A **general** subagent is available via `@general` prefix for complex searches and multi-step tasks.

## Built-in Tools

| Tool | Purpose | Permission Key |
|------|---------|----------------|
| **bash** | Execute shell commands | `bash` |
| **edit** | Modify files using exact string replacement | `edit` |
| **write** | Create new files or overwrite existing | `edit` |
| **read** | Read file contents | `read` |
| **grep** | Search file contents with regex | `grep` |
| **glob** | Find files by pattern matching | `glob` |
| **list** | List files and directories | `list` |
| **patch** | Apply patches to files | `edit` |
| **lsp** | Code intelligence (definitions, references) | `lsp` |
| **todowrite** | Manage todo lists | `todowrite` |
| **todoread** | Read existing todos | `todoread` |
| **webfetch** | Fetch and read web pages | `webfetch` |
| **websearch** | Web search via Exa AI | `websearch` |
| **question** | Ask user clarifying questions | `question` |
| **skill** | Load SKILL.md content | `skill` |

## Configuration

Configuration files are loaded in order (later overrides earlier):

1. Remote config (`.well-known/opencode`)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json` in project root)

### Example Configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "theme": "opencode",
  "permission": {
    "*": "ask",
    "read": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow"
    }
  },
  "agent": {
    "build": {
      "permission": {
        "edit": "allow"
      }
    }
  },
  "server": {
    "port": 4096,
    "hostname": "127.0.0.1"
  }
}
```

### Permission Values

| Value | Behavior |
|-------|----------|
| `allow` | Run without approval |
| `ask` | Prompt for approval |
| `deny` | Block the action |

In non-interactive mode (`-p` flag), all permissions are auto-approved.

---

## Server Protocol

The headless server is the primary integration surface for building GUI clients. It exposes an **OpenAPI 3.1** REST API with **Server-Sent Events (SSE)** for real-time updates.

### Starting the Server

```bash
opencode serve                                    # Default: localhost:4096
opencode serve --port 8080 --hostname 0.0.0.0    # Custom binding
OPENCODE_SERVER_PASSWORD=secret opencode serve   # Enable HTTP basic auth
```

### API Documentation

Access the interactive OpenAPI docs at:
```
http://localhost:4096/doc
```

### Core API Endpoints

#### Global

| Method | Path | Description |
|--------|------|-------------|
| GET | `/global/health` | Server status and version |
| GET | `/global/event` | SSE stream for real-time updates |

#### Project

| Method | Path | Description |
|--------|------|-------------|
| GET | `/project` | List all projects |
| GET | `/project/current` | Get active project |

#### Session Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/session` | List all sessions |
| POST | `/session` | Create new session |
| GET | `/session/:id` | Get session details |
| DELETE | `/session/:id` | Delete session |
| POST | `/session/:id/abort` | Stop running session |
| POST | `/session/:id/fork` | Branch session at specific message |

#### Message Exchange

| Method | Path | Description |
|--------|------|-------------|
| POST | `/session/:id/message` | Send prompt and get response |
| POST | `/session/:id/prompt_async` | Send prompt (returns 204, streams via SSE) |
| POST | `/session/:id/command` | Execute slash command |
| POST | `/session/:id/shell` | Run shell command |

**Message Request Body:**

```json
{
  "parts": [
    { "type": "text", "text": "Fix the authentication bug" }
  ],
  "model": "anthropic/claude-sonnet-4-5",
  "agent": "build",
  "noReply": false
}
```

**Response:**

```json
{
  "info": {
    "id": "msg_abc123",
    "sessionId": "sess_xyz",
    "role": "assistant"
  },
  "parts": [
    { "type": "text", "text": "I'll fix the authentication bug..." }
  ]
}
```

#### File Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/find?pattern=<regex>` | Full-text search |
| GET | `/find/file?query=<name>` | Fuzzy file search |
| GET | `/file/content?path=<path>` | Read file contents |
| GET | `/file/status` | Git status of tracked files |

#### Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Get current configuration |
| PATCH | `/config` | Update configuration |
| GET | `/config/providers` | List providers and models |

#### Provider Authentication

| Method | Path | Description |
|--------|------|-------------|
| GET | `/provider` | List connected providers |
| POST | `/provider/:id/oauth/authorize` | Start OAuth flow |
| POST | `/provider/:id/oauth/callback` | Complete OAuth flow |

### Server-Sent Events (SSE)

Connect to `/global/event` for real-time updates. Events are newline-delimited JSON.

**Initial Event:**
```json
{"type": "server.connected"}
```

**Session Events:**
```json
{"type": "session.created", "session": {...}}
{"type": "session.updated", "sessionId": "...", "message": {...}}
{"type": "message.delta", "sessionId": "...", "delta": "text chunk"}
{"type": "tool.started", "sessionId": "...", "tool": "bash", "input": {...}}
{"type": "tool.completed", "sessionId": "...", "result": {...}}
```

### TUI Remote Control

For controlling a remote TUI instance:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tui/submit-prompt` | Submit input |
| POST | `/tui/append-prompt` | Add text to prompt |
| POST | `/tui/open-sessions` | Show session selector |
| POST | `/tui/show-toast` | Display notification |

### Authentication

Set environment variables before starting the server:

```bash
export OPENCODE_SERVER_USERNAME=admin    # Default: opencode
export OPENCODE_SERVER_PASSWORD=secret
opencode serve
```

Clients must send HTTP Basic Auth header:
```
Authorization: Basic base64(username:password)
```

---

## ACP Protocol (Agent Client Protocol)

OpenCode supports ACP for IDE integration. ACP uses **JSON-RPC 2.0 over stdio** with newline-delimited messages.

### Starting ACP Server

```bash
opencode acp
```

### IDE Configuration

**Zed** (`~/.config/zed/settings.json`):
```json
{
  "agent_servers": {
    "OpenCode": {
      "command": "opencode",
      "args": ["acp"]
    }
  }
}
```

**JetBrains IDEs** (`acp.json`):
```json
{
  "agents": [{
    "id": "opencode",
    "name": "OpenCode",
    "command": "/path/to/opencode",
    "args": ["acp"]
  }]
}
```

**Neovim (Avante.nvim)**:
```lua
{
  provider = "opencode",
  command = "opencode",
  args = { "acp" }
}
```

### ACP Message Flow

```
Client (IDE)                         Agent (opencode acp)
  |                                      |
  |-- initialize ----------------------->|
  |<-- result (capabilities) ------------|
  |                                      |
  |-- session/new ---------------------->|
  |<-- result (sessionId) ---------------|
  |                                      |
  |-- session/prompt ------------------->|
  |<-- session/update (streaming) -------|
  |<-- session/request_permission -------|  (if approval needed)
  |-- result (selected option) --------->|
  |<-- result (stopReason) --------------|
```

### ACP Methods

**Client → Agent:**

| Method | Description |
|--------|-------------|
| `initialize` | Version and capability negotiation |
| `session/new` | Create conversation session |
| `session/prompt` | Send user prompt |
| `session/load` | Resume existing session |
| `session/cancel` | Cancel current operation |

**Agent → Client:**

| Method | Description |
|--------|-------------|
| `session/update` | Streaming responses and tool updates |
| `session/request_permission` | Request approval for operations |
| `fs/read_text_file` | Read file from workspace |
| `fs/write_text_file` | Write file to workspace |
| `terminal/create` | Create terminal session |
| `terminal/output` | Send terminal output |

### Supported Features

All OpenCode features work via ACP:
- Built-in tools
- Custom tools
- MCP servers
- Project rules (AGENTS.md)
- Formatters
- Permissions

**Limitation:** Slash commands like `/undo` and `/redo` are currently unsupported in ACP mode.

---

## SDK Integration

For programmatic control, use the official SDK:

```bash
npm install @opencode-ai/sdk
```

### Create Instance with Embedded Server

```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode()
```

### Connect to Existing Server

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
})
```

### SDK Methods

```typescript
// Health check
const health = await client.health()

// List sessions
const sessions = await client.session.list()

// Create session
const session = await client.session.create()

// Send prompt
const response = await client.session.prompt(session.id, {
  parts: [{ type: "text", text: "Fix the bug" }]
})

// Subscribe to events
client.event.subscribe((event) => {
  console.log(event.type, event)
})

// File operations
const results = await client.find.text({ pattern: "TODO" })
const content = await client.file.read({ path: "/src/main.ts" })
```

### TypeScript Types

```typescript
import type { Session, Message, Part } from "@opencode-ai/sdk"
```

---

## Comparison with Other Agents

| Feature | Claude Code | Codex | Gemini CLI | OpenCode |
|---------|------------|-------|------------|----------|
| **Protocol** | Bidirectional stream-json | JSON-RPC 2.0 app-server | Unidirectional NDJSON | HTTP API + SSE / ACP |
| **Process model** | One process per chat | One server, multiple threads | One process per prompt | Server with multiple sessions |
| **Session continuity** | `--resume <id>` via stdin | Thread IDs via JSON-RPC | `--resume` flag | Session API / `--session` |
| **Tool approvals** | Interactive via stdin | Server-initiated requests | Pre-configured flags | Configurable permissions |
| **IDE integration** | ACP | ACP | N/A | ACP |
| **Providers** | Anthropic only | OpenAI only | Google only | 75+ providers |

### Key Differences for Overseer Integration

1. **Server-based architecture**: OpenCode runs a persistent HTTP server, unlike Claude Code's stdin/stdout protocol
2. **SSE for streaming**: Real-time updates via `/global/event` endpoint
3. **Provider agnostic**: Can use any supported provider, switchable mid-session
4. **REST API**: Standard HTTP endpoints instead of JSON-RPC
5. **ACP support**: Same protocol as Copilot CLI for IDE integration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_CONFIG` | Custom config file path |
| `OPENCODE_CONFIG_DIR` | Configuration directory |
| `OPENCODE_CONFIG_CONTENT` | Inline JSON config |
| `OPENCODE_PERMISSION` | Inline permissions JSON |
| `OPENCODE_SERVER_PASSWORD` | HTTP basic auth password |
| `OPENCODE_SERVER_USERNAME` | HTTP basic auth username (default: opencode) |
| `OPENCODE_AUTO_SHARE` | Auto-share sessions |
| `OPENCODE_DISABLE_AUTOUPDATE` | Skip update checks |
| `OPENCODE_EXPERIMENTAL` | Enable experimental features |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GITHUB_TOKEN` | GitHub Copilot token |

## Overseer Implementation Notes

This section documents implementation details and gotchas discovered while integrating OpenCode with Overseer.

### CORS and Authentication Issue

**Problem**: When `OPENCODE_SERVER_PASSWORD` is set, the server requires HTTP Basic Auth for all requests, including CORS preflight (OPTIONS) requests. Browsers don't send Authorization headers on preflight requests by design, causing 401 errors.

**Solution**: Run the server without password authentication. Since the server only listens on `127.0.0.1` (localhost), this is reasonably safe for local development.

```rust
// In opencode.rs - do NOT set the password env var
cmd.args(&args)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
// Intentionally omit: .env("OPENCODE_SERVER_PASSWORD", &password)
```

The server will show a warning ("OPENCODE_SERVER_PASSWORD is not set; server is unsecured") but runs correctly.

### Message API Format

**Endpoint**: Use `POST /session/:id/message` (not `/session/:id/prompt_async`)

**Request body** must use `parts` array format:

```json
{
  "parts": [
    { "type": "text", "text": "Your prompt here" }
  ]
}
```

The `parts` array accepts these input types (from OpenAPI spec):
- `TextPartInput`: `{ "type": "text", "text": "..." }` (required fields)
- `FilePartInput`: For file attachments
- `AgentPartInput`: For agent-specific data
- `SubtaskPartInput`: For subtask management

**Common mistake**: Using `{ "prompt": "..." }` format will fail with:
```json
{
  "error": [{
    "expected": "array",
    "code": "invalid_type",
    "path": ["parts"],
    "message": "Invalid input: expected array, received undefined"
  }]
}
```

### Session Creation

Create a session before sending messages:

```typescript
const response = await fetch(`http://127.0.0.1:${port}/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    workingDir: "/path/to/project",
    permissions: { "*": "allow" }  // Permissive mode for GUI integration
  }),
})
const { id: sessionId } = await response.json()
```

### SSE Event Stream

Connect to SSE before sending messages to avoid missing events:

```typescript
// Connect first
const eventSource = new EventSource(
  `http://127.0.0.1:${port}/session/${sessionId}/events`
)

// Then send message
await fetch(`http://127.0.0.1:${port}/session/${sessionId}/message`, ...)
```

**Key SSE events**:
- `message.part.updated` - Text deltas (streaming response)
- `tool.started` - Tool invocation began
- `tool.completed` - Tool finished with result
- `session.completed` - Turn finished

### Server Startup

The server needs a moment to initialize. Wait for it to be ready:

```rust
// Find available port
let actual_port = find_available_port(14096)?;

// Start server
let mut child = Command::new(&opencode_path)
    .args(&["serve", "--port", &actual_port.to_string(), "--cors", "http://localhost:1420"])
    .spawn()?;

// The server outputs "opencode server listening on http://..." when ready
```

### Default Ports

- OpenCode default: `4096`
- Overseer uses: `14096` (to avoid conflicts)
- Tauri dev server: `1420` (must be in `--cors` allowlist)

### Using the SDK (v2)

Overseer uses the official `@opencode-ai/sdk` for communication with the OpenCode server. The SDK v2 API uses flat parameters instead of nested objects:

```typescript
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"

// Create client
const client = createOpencodeClient({
  baseUrl: `http://127.0.0.1:${port}`,
  directory: workingDir,
})

// Health check - wait for server to be ready
const health = await client.global.health()
if (!health.data?.healthy) throw new Error("Server not ready")

// Create session with permissive permissions
const session = await client.session.create({
  directory: workingDir,
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
})

// Send message (synchronous API - returns complete response)
const response = await client.session.prompt({
  sessionID: session.data.id,
  directory: workingDir,
  parts: [{ type: "text", text: "Your prompt" }],
  model: { providerID: "", modelID: "anthropic/claude-sonnet-4-5" },
})

// Response contains all parts
response.data.parts.forEach((part) => {
  if (part.type === "text") console.log(part.text)
  if (part.type === "tool-invocation") console.log(part.tool.name, part.tool.input)
})
```

**SDK v2 gotchas**:
- Use `@opencode-ai/sdk/v2/client` import path (the `/v2` path includes server code that uses Node.js `spawn` which fails in browser builds)
- Session creation uses `permission` (array), not `permissions` (object)
- Use `prompt` method (synchronous) instead of `message` for simpler integration
- The `providerID` can be empty string when specifying `modelID`

### SSE via Rust Backend

Browser long-polling for SSE can block browser sockets. Overseer handles SSE in Rust instead, publishing events via Tauri's event system:

```rust
// In opencode.rs - Tauri commands for SSE handling
#[tauri::command]
pub fn opencode_subscribe_events(
    app: tauri::AppHandle,
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
    session_id: String,
) -> Result<(), String> {
    // ... spawns thread that connects to /global/event
    // Emits events to frontend: opencode:event:{server_id}
}

#[tauri::command]
pub fn opencode_unsubscribe_events(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<(), String> {
    // Stops the SSE subscription thread
}
```

Frontend listens via Tauri events:

```typescript
import { listen } from "@tauri-apps/api/event"

await listen(`opencode:event:${serverId}`, (event) => {
  const { event_type, payload } = event.payload
  // Handle different event types
})
```

### Fetching Models from Server

Models are fetched from the running server via Rust:

```rust
#[tauri::command]
pub fn opencode_get_models(
    state: tauri::State<OpenCodeServerMap>,
    server_id: String,
) -> Result<Vec<OpenCodeModel>, String> {
    // Fetches from GET /config/providers
    // Returns models with id (provider/model format) and name
}
```

The `/config/providers` endpoint returns:
```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "models": {
        "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" }
      }
    }
  ]
}
```

Models are returned in `provider/model` format (e.g., `anthropic/claude-sonnet-4-5`).

### Listing Models via CLI

For Settings or when no server is running, use the `opencode_list_models` command which runs `opencode models`:

```rust
#[tauri::command]
pub fn opencode_list_models(opencode_path: String) -> Result<Vec<OpenCodeModel>, String> {
    // Runs `opencode models` and parses the output
    // Each line is "provider/model" format
}
```

TypeScript usage:

```typescript
import { listOpencodeModels } from "../services/opencode"

const models = await listOpencodeModels(configStore.opencodePath)
// Returns: [{ alias: "anthropic/claude-sonnet-4-5", displayName: "anthropic - claude-sonnet-4-5" }, ...]
```

### Model Format When Sending Messages

OpenCode expects the model to be split into `providerID` and `modelID`:

```typescript
// Parse "anthropic/claude-sonnet-4-5" into provider and model parts
const slashIndex = modelVersion.indexOf("/")
const modelParam = {
  providerID: modelVersion.substring(0, slashIndex),  // "anthropic"
  modelID: modelVersion.substring(slashIndex + 1),    // "claude-sonnet-4-5"
}

await client.session.prompt({
  sessionID,
  parts: [{ type: "text", text: prompt }],
  model: modelParam,
})
```

**Common mistake**: Passing `{ providerID: "", modelID: "anthropic/claude-sonnet-4-5" }` will fail with `ProviderModelNotFoundError`.

## Links

- Website: [opencode.ai](https://opencode.ai/)
- GitHub: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Documentation: [opencode.ai/docs](https://opencode.ai/docs/)
- Server docs: [opencode.ai/docs/server](https://opencode.ai/docs/server/)
- SDK docs: [opencode.ai/docs/sdk](https://opencode.ai/docs/sdk/)
- ACP docs: [opencode.ai/docs/acp](https://opencode.ai/docs/acp/)
- Discord: [opencode.ai/discord](https://opencode.ai/discord)
