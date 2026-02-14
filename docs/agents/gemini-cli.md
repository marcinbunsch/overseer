# Gemini CLI

Gemini CLI is an open-source AI coding agent from Google that brings Gemini directly into the terminal. It uses a ReAct (reason and act) loop with built-in tools and MCP servers to complete tasks. For GUI integrations, Gemini CLI supports a headless non-interactive mode with structured JSON output over stdout.

> Source: https://github.com/google-gemini/gemini-cli

## Quick Start

### Installation

```bash
# npm (recommended)
npm install -g @google/gemini-cli

# Or run directly with npx
npx @google/gemini-cli
```

Requires Node.js 20+.

### Authentication

```bash
# API key (simplest)
export GEMINI_API_KEY=your-api-key

# Google Cloud credentials
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Google Cloud project (for Vertex AI)
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_CLOUD_LOCATION=us-central1
```

Also supports:
- **API Key**: `GEMINI_API_KEY` or `GOOGLE_API_KEY` environment variable
- **Google Cloud**: Service account via `GOOGLE_APPLICATION_CREDENTIALS`
- **Vertex AI**: `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`

### Platform Support

- **macOS & Linux** — fully supported
- **Windows** — via WSL

## CLI Commands

### Interactive Mode

```bash
gemini                                    # Launch interactive TUI
gemini -i "Tell me about this project"   # Interactive with initial prompt
gemini -m gemini-2.5-pro                 # Override model
```

### Non-Interactive (Headless) Mode

```bash
gemini -p "Fix the login bug"                              # Single prompt, exits after
gemini -p "Explain this code" --output-format json          # Structured JSON output
gemini -p "Refactor auth" --output-format stream-json       # NDJSON streaming events
echo "Summarize this" | gemini                              # Pipe input via stdin
cat README.md | gemini -p "Summarize this documentation"    # Combined file + prompt
```

### Session Management

```bash
gemini --resume                    # Resume most recent session
gemini --resume 1                  # Resume by index
gemini --resume <session-uuid>     # Resume specific session by UUID
gemini --list-sessions             # List available sessions
gemini --delete-session <id>       # Delete a session
```

Sessions are stored in `~/.gemini/tmp/<project_hash>/chats/` and are project-specific.

### Interactive Slash Commands

| Command | Description |
|---------|-------------|
| `/chat save <tag>` | Save conversation checkpoint |
| `/chat list` | List saved checkpoints |
| `/resume` | Browse and resume sessions interactively |
| `/memory` | Manage project memory |
| `/settings` | View/edit settings |
| `/stats` | View token usage statistics |
| `/compress` | Compress conversation context |

## CLI Global Flags

| Flag | Description |
|------|-------------|
| `--prompt, -p <text>` | Non-interactive mode with direct prompt |
| `--prompt-interactive, -i <text>` | Interactive session with initial prompt |
| `--model, -m <string>` | Override configured model |
| `--output-format <format>` | `text`, `json`, or `stream-json` |
| `--approval-mode <mode>` | `default`, `auto_edit`, `yolo`, `plan` |
| `--yolo, -y` | Auto-approve all tool calls + enable sandbox |
| `--allowed-tools <list>` | Comma-separated tools bypassing confirmation |
| `--sandbox, -s` | Enable sandbox environment |
| `--resume, -r [id]` | Resume previous session |
| `--list-sessions` | Display available sessions |
| `--include-directories <dirs>` | Add workspace directories (max 5) |
| `--extensions, -e <names>` | Specify extensions ("none" to disable all) |
| `--debug, -d` | Enable verbose debug output |
| `--screen-reader` | Enable screen reader mode |

## Approval Modes

| Mode | Behavior |
|------|----------|
| `default` | Prompt for approval on each tool call |
| `auto_edit` | Auto-approve file edits; prompt for others |
| `yolo` | Auto-approve all tool calls |
| `plan` | Planning mode — no tool execution |

## Built-in Tools

Gemini CLI includes built-in tools for:

- **File operations**: Read, write, edit, search files
- **Shell execution**: Run terminal commands
- **Web fetching**: Fetch web pages and URLs
- **Google Search**: Grounded search for real-time information
- **MCP integration**: Connect to external MCP servers

## Configuration

### Settings File

Stored in `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project-scoped).

Key settings:

| Setting | Type | Description |
|---------|------|-------------|
| `model.name` | `string` | Default Gemini model |
| `model.maxSessionTurns` | `number` | Conversation history limit |
| `tools.approvalMode` | `string` | `default`, `auto_edit`, `plan` |
| `tools.sandbox` | `boolean\|string` | Sandbox configuration |
| `tools.allowed` | `string[]` | Auto-approved tool prefixes |
| `tools.exclude` | `string[]` | Blocked tools |
| `output.format` | `string` | Default output format |

### Context Files

- **GEMINI.md**: Project-specific instructions (like CLAUDE.md)
- **.gemini/settings.json**: Project-scoped settings
- **.gemini/sandbox.Dockerfile**: Custom sandbox image

### Configuration Precedence (lowest to highest)

1. Hardcoded defaults
2. System defaults (`/etc/gemini-cli/system-defaults.json`)
3. User settings (`~/.gemini/settings.json`)
4. Project settings (`.gemini/settings.json`)
5. System overrides (`/etc/gemini-cli/settings.json`)
6. Environment variables (including `.env` files)
7. Command-line arguments

---

## Headless Protocol

The headless mode is the primary integration surface for building GUI clients. Gemini CLI is spawned as a child process with `--prompt` and `--output-format stream-json`. Communication is **unidirectional** — prompts flow in via arguments/stdin, structured events flow out on stdout.

### Communication Model

Unlike Claude Code (bidirectional stream-json over stdin/stdout) or Codex (JSON-RPC 2.0 app-server), Gemini CLI uses a **one-shot execution model**:

1. Spawn process with prompt and flags
2. Read NDJSON events from stdout
3. Process exits when done
4. For follow-up messages, spawn a new process with `--resume`

There is no persistent bidirectional channel — tool approvals cannot be sent back interactively in headless mode. Use `--yolo` or `--approval-mode auto_edit` to handle approvals automatically.

### Output Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `text` | Plain text streamed to stdout | Human-readable output |
| `json` | Single JSON object at completion | Post-processing, CI |
| `stream-json` | NDJSON events in real-time | GUI integration, live UI |

### Invocation

```bash
# Basic headless invocation
gemini -p "Fix the bug in auth.py" --output-format stream-json --yolo

# With model override
gemini -p "Refactor this module" --output-format stream-json --model gemini-2.5-pro --yolo

# Resume a session
gemini -p "Now add tests" --output-format stream-json --resume <session-uuid> --yolo

# With specific approval mode
gemini -p "Update the API" --output-format stream-json --approval-mode auto_edit
```

## Streaming Events (NDJSON)

When using `--output-format stream-json`, each line of stdout is a complete JSON object representing a discrete event. Events include a `type` and `timestamp` field.

### Event Types

| Type | Description |
|------|-------------|
| `INIT` | Session initialization with session ID and model info |
| `MESSAGE` | User prompt or assistant response (supports streaming deltas) |
| `TOOL_USE` | Tool invocation with parameters |
| `TOOL_RESULT` | Tool execution result (success or error) |
| `ERROR` | Non-fatal error or warning |
| `RESULT` | Final session outcome with aggregated statistics |

### `INIT` Event

Emitted at session start with session metadata.

```json
{
  "type": "INIT",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "model": "gemini-2.5-pro",
  "timestamp": "2025-12-01T12:00:00.000Z"
}
```

### `MESSAGE` Event

Emitted for user prompts and assistant responses. Supports streaming via `delta: true`.

```json
{
  "type": "MESSAGE",
  "role": "assistant",
  "content": "I'll fix the bug in auth.py.",
  "delta": false,
  "timestamp": "2025-12-01T12:00:01.000Z"
}
```

When `delta` is `true`, the `content` field contains an incremental chunk of text rather than the complete message.

```json
{
  "type": "MESSAGE",
  "role": "assistant",
  "content": "I'll fix",
  "delta": true,
  "timestamp": "2025-12-01T12:00:01.000Z"
}
```

### `TOOL_USE` Event

Emitted when the agent invokes a tool.

```json
{
  "type": "TOOL_USE",
  "toolName": "shell",
  "callId": "tool-call-123",
  "params": {
    "command": ["npm", "test"]
  },
  "timestamp": "2025-12-01T12:00:02.000Z"
}
```

### `TOOL_RESULT` Event

Emitted after tool execution completes.

```json
{
  "type": "TOOL_RESULT",
  "callId": "tool-call-123",
  "status": "success",
  "result": "All 42 tests passed.",
  "timestamp": "2025-12-01T12:00:05.000Z"
}
```

Error case:

```json
{
  "type": "TOOL_RESULT",
  "callId": "tool-call-123",
  "status": "error",
  "error": "Command exited with code 1",
  "timestamp": "2025-12-01T12:00:05.000Z"
}
```

### `ERROR` Event

Non-fatal errors or warnings during execution.

```json
{
  "type": "ERROR",
  "message": "Rate limit exceeded, retrying...",
  "code": "RATE_LIMIT",
  "timestamp": "2025-12-01T12:00:06.000Z"
}
```

### `RESULT` Event

Final event with session outcome and aggregated statistics.

```json
{
  "type": "RESULT",
  "success": true,
  "stats": {
    "models": {
      "gemini-2.5-pro": {
        "api": { "requests": 3, "errors": 0, "latencyMs": 2500 },
        "tokens": { "prompt": 1200, "candidates": 800, "total": 2000, "cached": 0 }
      }
    },
    "tools": {
      "totalCalls": 5,
      "totalSuccess": 5,
      "totalFail": 0,
      "totalDurationMs": 3200,
      "byName": {
        "shell": { "calls": 2, "success": 2, "fail": 0 },
        "write_file": { "calls": 3, "success": 3, "fail": 0 }
      }
    },
    "files": {
      "totalLinesAdded": 15,
      "totalLinesRemoved": 3
    }
  },
  "timestamp": "2025-12-01T12:00:10.000Z"
}
```

## JSON Output Format

When using `--output-format json`, a single JSON object is written at completion:

```json
{
  "response": "I've fixed the authentication bug by...",
  "stats": {
    "models": {
      "gemini-2.5-pro": {
        "api": { "requests": 3, "errors": 0 },
        "tokens": { "prompt": 1200, "candidates": 800, "total": 2000 }
      }
    },
    "tools": {
      "totalCalls": 5,
      "totalSuccess": 5,
      "totalFail": 0,
      "totalDurationMs": 3200,
      "byName": { "shell": { "calls": 2 }, "write_file": { "calls": 3 } }
    },
    "files": {
      "totalLinesAdded": 15,
      "totalLinesRemoved": 3
    }
  }
}
```

Error case includes:

```json
{
  "response": "",
  "stats": { ... },
  "error": {
    "type": "TOOL_ERROR",
    "message": "Command failed with exit code 1",
    "code": "TOOL_EXECUTION_FAILED"
  }
}
```

## Session Management

### Automatic Saving

Sessions are automatically saved after every interaction (v0.20.0+). No manual save is required.

### Session Storage

Sessions are stored in `~/.gemini/tmp/<project_hash>/chats/` and are project-specific — switching directories switches the session history.

### Resuming Sessions

```bash
# Resume most recent session
gemini --resume

# Resume by index
gemini --resume 1

# Resume by UUID
gemini --resume a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Resume in headless mode with new prompt
gemini -p "Continue refactoring" --resume --output-format stream-json --yolo
```

### Session IDs

Sessions use UUID format (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`). The session ID is provided in the `INIT` event when using `stream-json` output format.

### Session Retention

Configure automatic cleanup in settings:

```json
{
  "general": {
    "sessionRetention": {
      "maxAge": "30d",
      "maxCount": 100,
      "minRetention": "7d"
    }
  }
}
```

## Hooks

Gemini CLI supports hooks for intercepting agent execution:

| Hook | Trigger |
|------|---------|
| `BeforeTool` | Before tool executes |
| `AfterTool` | After tool execution |
| `BeforeAgent` | Before agent turn |
| `AfterAgent` | After agent turn |
| `SessionStart` | Session initialization |
| `SessionEnd` | Session termination |
| `PreCompress` | Before context compression |
| `BeforeModel` | Before model API call |
| `AfterModel` | After model API response |

Configured in `.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeTool": [
      { "command": "echo 'Tool starting'" }
    ]
  }
}
```

## MCP Integration

Gemini CLI supports MCP (Model Context Protocol) servers for extensibility:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    },
    "remote-api": {
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer $API_TOKEN" }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Gemini API key |
| `GOOGLE_API_KEY` | Google Cloud API key |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account JSON path |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | GCP region |
| `GEMINI_MODEL` | Default model override |
| `GEMINI_SANDBOX` | Sandbox mode |
| `GEMINI_CLI_HOME` | Custom config directory |

## Key Differences from Claude Code and Codex

| Feature | Claude Code | Codex | Gemini CLI |
|---------|------------|-------|------------|
| **Protocol** | Bidirectional stream-json (stdin/stdout) | JSON-RPC 2.0 app-server | Unidirectional NDJSON (stdout only) |
| **Process model** | One process per chat, persistent stdin | One server, multiple threads | One process per prompt, exit on done |
| **Session continuity** | `--resume <sessionId>` via stdin | Thread IDs via JSON-RPC | `--resume` with new process spawn |
| **Tool approvals** | Interactive via stdin `control_response` | Server-initiated JSON-RPC requests | Pre-configured (`--yolo`, `--approval-mode`) |
| **Follow-up messages** | Send via stdin on same process | `turn/start` on same server | Spawn new process with `--resume` |
| **Streaming** | Content block deltas | Item deltas via notifications | MESSAGE events with `delta: true` |

### Integration Implications

Because Gemini CLI uses a **one-shot process model** rather than a persistent connection:

1. **Each message requires a new process**: Spawn `gemini -p "prompt" --output-format stream-json --resume <id>` for each user message
2. **No interactive tool approvals**: Use `--yolo` or `--approval-mode auto_edit` since there's no way to send approval responses back via stdin in headless mode
3. **Session state is file-based**: The CLI reads/writes session history from disk, not from an in-memory server
4. **Process lifecycle is simpler**: No initialization handshake, no keepalive — just spawn, read events, wait for exit

## Links

- GitHub: [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- [Official documentation](https://google-gemini.github.io/gemini-cli/)
- [Headless mode guide](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)
- [Configuration reference](https://geminicli.com/docs/get-started/configuration/)
- [Session management](https://geminicli.com/docs/cli/session-management/)
- [Google announcement blog post](https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent/)
