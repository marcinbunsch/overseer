# GitHub Copilot CLI Integration

This document describes the Agent Client Protocol (ACP) used by GitHub Copilot CLI and how to integrate it with Overseer.

## Overview

GitHub Copilot CLI is a command-line AI coding agent that can be integrated into Overseer using the **Agent Client Protocol (ACP)** - an open standard for agent-editor communication. ACP uses JSON-RPC 2.0 over stdio, similar to how Codex is already integrated.

**References:**
- [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- [ACP Server Reference](https://docs.github.com/en/copilot/reference/acp-server)
- [ACP Protocol Specification](https://agentclientprotocol.com)

## Starting Copilot in ACP Mode

```bash
# stdio mode (recommended for IDE integration)
copilot --acp --stdio

# TCP mode (for remote/network access)
copilot --acp --port 3000
```

## Protocol Basics

- **Transport**: JSON-RPC 2.0 over stdio (NDJSON - newline-delimited JSON)
- **Encoding**: UTF-8
- **Message types**:
  - **Methods**: Request-response pairs (have `id`)
  - **Notifications**: One-way messages (no `id`)
- **File paths**: Must be absolute
- **Line numbers**: 1-based indexing

## Message Flow

```
Client (Overseer)                    Agent (copilot --acp --stdio)
  |                                      |
  |-- initialize ----------------------->|
  |<-- result (capabilities) ------------|
  |                                      |
  |-- session/new ---------------------->|
  |<-- result (sessionId) ---------------|
  |                                      |
  |-- session/prompt ------------------->|
  |<-- session/update (streaming) -------|  (notifications)
  |<-- session/request_permission -------|  (approval request)
  |-- result (selected option) --------->|
  |<-- session/update (tool updates) ----|
  |<-- result (stopReason) --------------|
```

## Initialization

### Request: `initialize`

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "id": 1,
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "overseer",
      "title": "Overseer",
      "version": "1.0.0"
    },
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": true
    }
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "copilot",
      "title": "GitHub Copilot",
      "version": "1.0.0"
    },
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "text": true,
        "images": false,
        "audio": false,
        "embeddedContext": false
      },
      "sessionCapabilities": {}
    },
    "authMethods": []
  }
}
```

**Key capabilities:**
- `loadSession`: If true, agent supports `session/load` to resume previous sessions
- `promptCapabilities`: Supported content types in prompts

## Session Management

### Create Session: `session/new`

```json
{
  "method": "session/new",
  "id": 2,
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

Response:
```json
{
  "id": 2,
  "result": {
    "sessionId": "sess_abc123def456"
  }
}
```

### Load Session: `session/load`

Only available if `loadSession` capability is true.

```json
{
  "method": "session/load",
  "id": 2,
  "params": {
    "sessionId": "sess_abc123def456",
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

The agent replays the conversation via `session/update` notifications before responding with `null`.

## Sending Prompts

### Request: `session/prompt`

```json
{
  "method": "session/prompt",
  "id": 3,
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [
      { "type": "text", "text": "Fix the authentication bug in login.ts" }
    ]
  }
}
```

### Response (when turn completes)

```json
{
  "id": 3,
  "result": {
    "stopReason": "end_turn"
  }
}
```

**Stop reasons:**
- `end_turn`: Model finished normally
- `max_tokens`: Token limit reached
- `max_turn_requests`: Request limit exceeded
- `refusal`: Agent declined to continue
- `cancelled`: Client cancelled via `session/cancel`

## Streaming Updates

During prompt processing, the agent sends `session/update` notifications. Updates are nested under `params.update` with `sessionUpdate` as the type field:

### Text Streaming

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "I'll fix the authentication..."
      }
    }
  }
}
```

### Tool Call Started

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "tc_123",
      "title": "Edit login.ts",
      "kind": "edit",
      "status": "pending",
      "rawInput": { "path": "/path/to/login.ts" }
    }
  }
}
```

**Tool kinds:**
- `read` - File/data retrieval
- `edit` - Content modification
- `delete` - File/data removal
- `move` - File renaming/relocation
- `search` - Information lookup
- `execute` - Command/code running
- `think` - Internal reasoning
- `fetch` - External data retrieval
- `other` - Miscellaneous

### Tool Call Update

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "tc_123",
      "status": "in_progress"
    }
  }
}
```

### Tool Call Completed

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "tc_123",
      "status": "completed",
      "rawOutput": { "content": "file contents..." }
    }
  }
}
```

### Plan Updates

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "plan",
      "steps": [
        { "description": "Analyze the bug", "status": "completed" },
        { "description": "Fix authentication logic", "status": "in_progress" },
        { "description": "Add error handling", "status": "pending" }
      ]
    }
  }
}
```

## Permission Requests

When the agent needs approval, it sends a server-initiated request:

### Request: `session/request_permission`

```json
{
  "method": "session/request_permission",
  "id": 10,
  "params": {
    "title": "Execute command",
    "description": "Run: npm test",
    "options": [
      { "optionId": "allow_once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "allow_always", "name": "Always allow", "kind": "allow_always" },
      { "optionId": "reject_once", "name": "Reject", "kind": "reject_once" },
      { "optionId": "reject_always", "name": "Always reject", "kind": "reject_always" }
    ]
  }
}
```

### Response

```json
{
  "id": 10,
  "result": {
    "selected": { "optionId": "allow_once" }
  }
}
```

**Option kinds:**
- `allow_once` - Execute this time only
- `allow_always` - Execute and remember preference
- `reject_once` - Block this time
- `reject_always` - Block and remember preference

If cancelled during a permission request, respond with:
```json
{
  "id": 10,
  "result": { "cancelled": true }
}
```

## Cancellation

### Notification: `session/cancel`

```json
{
  "method": "session/cancel",
  "params": {
    "sessionId": "sess_abc123def456"
  }
}
```

The agent aborts operations and responds to the pending `session/prompt` with `stopReason: "cancelled"`.

## Session Configuration

### Set Config Option: `session/set_config_option`

```json
{
  "method": "session/set_config_option",
  "id": 5,
  "params": {
    "sessionId": "sess_abc123def456",
    "optionId": "model",
    "value": "claude-sonnet-4-5"
  }
}
```

### Set Mode: `session/set_mode`

```json
{
  "method": "session/set_mode",
  "id": 6,
  "params": {
    "sessionId": "sess_abc123def456",
    "modeId": "plan"
  }
}
```

## Comparison with Codex Protocol

| Aspect | Codex | ACP (Copilot) |
|--------|-------|---------------|
| Init handshake | `initialize` + `initialized` notification | `initialize` only |
| Session creation | `thread/start` → threadId | `session/new` → sessionId |
| Send prompt | `turn/start` | `session/prompt` |
| Text streaming | `item/agentMessage/delta` | `session/update` (agent_message_chunk) |
| Tool started | `item/started` | `session/update` (tool_call) |
| Tool completed | `item/completed` | `session/update` (tool_call_update) |
| Approvals | Server request by method name | `session/request_permission` |
| Cancel | `turn/interrupt` notification | `session/cancel` notification |
| Turn complete | `turn/completed` notification | Response to `session/prompt` |

## Authentication

Copilot CLI uses GitHub authentication via `gh auth login`. Overseer does not need to handle authentication directly - if auth is required, detect the error and prompt the user to run:

```bash
gh auth login
```

## Error Codes

Standard JSON-RPC error codes:
- `-32700`: Parse error
- `-32600`: Invalid request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000`: Authentication required
- `-32002`: Resource not found

## Status

ACP support in GitHub Copilot CLI is **in public preview** and subject to change. The protocol is versioned via `protocolVersion` for compatibility.
