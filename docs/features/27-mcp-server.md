# MCP Server (`/mcp`)

Lets any MCP client — Claude Desktop, an agent, a script — *drive* Overseer over the
Model Context Protocol: create a workspace, start a session, send a message, and read the
replies. It is the same capability as the [Driving API](26-driving-api.md), exposed as MCP
tools instead of raw HTTP calls.

It sits on top of the existing [HTTP server](25-http-server.md): start the server and, if
authentication is on, use the same bearer token. Only Claude is supported for now.

## Connecting

The endpoint is `http://<host>:<port>/mcp`. It speaks MCP's Streamable HTTP transport. When
the HTTP server has authentication enabled, send the token as `Authorization: Bearer <token>`
(the same header the REST API uses). An MCP client entry looks like:

```json
{
  "mcpServers": {
    "overseer": {
      "url": "http://127.0.0.1:3210/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Tools

| Tool | Args | Returns |
|---|---|---|
| `list_projects` | — | `[{ id, name, path }]` |
| `create_workspace` | `project_id`, `branch` | `{ id, projectId, name, branch, path }` |
| `create_session` | `workspace_id`, `label?`, `model_version?`, `permission_mode?` | `{ sessionId }` |
| `get_session` | `session_id` | `{ sessionId, workspaceId, label, agentType, running, lastSeq }` |
| `send_message` | `session_id`, `text` | `{ accepted, lastSeq }` |
| `read_messages` | `session_id`, `view?`, `since_seq?` | `{ messages, lastSeq, running, turnComplete }` |

Each tool returns the driving API's `{ success, data }` envelope as JSON text content.

Sessions created here run in `bypassPermissions` mode by default, so the agent never stops
to ask a human to approve a command.

## How a client uses it

1. `list_projects` to see the projects.
2. `create_workspace` in one of them (a git worktree on a new branch).
3. `create_session` in that workspace.
4. `send_message`. This returns straight away — it does **not** wait for the reply.
5. `read_messages`, passing `since_seq` = the last sequence number you saw, until
   `turnComplete` is `true`. The new messages then hold the agent's reply.
6. `send_message` again to continue.

`view` picks the detail level for `read_messages`: `text` (default) is just the exchange;
`full` adds thinking, tool calls, tool results and bash output. See the
[Driving API doc](26-driving-api.md#reading-messages) for the message shape — it is identical.

## Implementation

Lives in `crates/overseer-http/src/mcp.rs`:

- `OverseerMcp` — an rmcp `ServerHandler` holding the shared HTTP state. Its six `#[tool]`
  methods wrap the matching `api_v1` handlers (`workspaces`, `sessions`, `messages`) — the
  request body is built with `serde_json` and the handler's envelope is returned verbatim, so
  the MCP tools and the REST API share one implementation.
- `lib.rs` mounts rmcp's `StreamableHttpService` at `/mcp` **inside** the protected router, so
  the existing bearer-token auth middleware guards it with no MCP-specific auth code. Because
  it reuses the same core managers and writes the same on-disk files, a session driven over MCP
  opens in the desktop app like any other.

Built with the official Rust MCP SDK ([`rmcp`](https://crates.io/crates/rmcp)).
