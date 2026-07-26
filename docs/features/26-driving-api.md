# Driving API (`/api/v1`)

Lets another agent — Claude, Codex, a shell script, anything that speaks HTTP —
*drive* Overseer: create a workspace, start a session, send messages, and read the
replies. The driver is the boss; the coding agent (Claude) does the work; and every
message is stored in Overseer's normal on-disk format, so a session driven through
the API opens in the desktop app like any other.

It sits on top of the existing [HTTP server](25-http-server.md) — start the server
and use the same bearer token. Only Claude is supported for now.

## How a driver uses it

1. Ask which projects exist.
2. Create a workspace in one of them (a git worktree on a new branch).
3. Start a session in that workspace.
4. Send a message. This returns straight away — it does **not** wait for the reply.
5. Read the messages, passing back the last sequence number you saw, until the
   turn is done. Then read the agent's reply.
6. Send the next message to continue.

Sessions created here run in `bypassPermissions` mode by default, so the agent
never stops to ask a human to approve a command.

## Endpoints

All requests carry `Authorization: Bearer <token>` and return
`{ "success": true, "data": ... }` or `{ "success": false, "error": "..." }`.

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/v1/projects` | — | `[{ id, name, path }]` |
| `POST /api/v1/projects/{projectId}/workspaces` | `{ "branch": "..." }` | `{ id, projectId, name, branch, path }` |
| `POST /api/v1/workspaces/{workspaceId}/sessions` | `{ "label"?, "modelVersion"?, "permissionMode"? }` | `{ sessionId }` |
| `GET /api/v1/sessions/{sessionId}` | — | `{ sessionId, workspaceId, label, agentType, running, lastSeq }` |
| `POST /api/v1/sessions/{sessionId}/messages` | `{ "text": "...", "attachments"? }` | `{ accepted, lastSeq }` |
| `GET /api/v1/sessions/{sessionId}/messages?view=…&sinceSeq=N` | — | `{ messages, lastSeq, running, turnComplete }` |
| `POST /api/v1/sessions/{sessionId}/attachments?filename=NAME` | raw file bytes | `{ id, filename, path, mimeType, size }` |

### Reading messages

`view` picks how much detail you get:

- **`text`** (default) — only the exchange: your messages and the agent's text
  replies. No thinking, no tool calls, no tool output.
- **`full`** — everything the desktop UI shows: adds thinking, tool calls, tool
  results and bash output.

Each returned message has a `seq` (its line number in the stored event log).
`sinceSeq` returns only messages after that number, so a driver polls like this:

1. Send a message; note the `lastSeq` it returns.
2. `GET .../messages?sinceSeq=<lastSeq>`.
3. If `turnComplete` is `false`, wait a moment and poll again with the new
   `lastSeq`. When it's `true`, the agent has finished; the new `messages` hold
   the reply.

A message looks like:

```json
{ "seq": 12, "role": "assistant", "text": "Done — created HELLO.md.", "kind": "tool", "toolName": "Bash" }
```

`role` is `user`, `assistant` or `tool`. `kind` is absent for plain text and one of
`thinking`, `tool`, `toolResult`, `bashOutput` otherwise. `toolName` and `isError`
appear when relevant.

## Attaching files

There is no special attachment channel to the agent — attaching a file means
storing it and putting its path in the prompt, so the agent reads it with its
normal file tools. Two steps:

1. Upload the bytes: `POST /api/v1/sessions/{id}/attachments?filename=spec.md`
   with the file as the raw request body. You get back
   `{ id, filename, path, mimeType, size }`. Files are stored under
   `{config}/attachments/{id}/`. The upload limit is 32 MiB.
2. Send a message with an `attachments` array — pass back the object(s) from step
   1 (only `path` is required):

   ```json
   { "text": "review this spec", "attachments": [ { "path": "/…/spec.md" } ] }
   ```

The agent receives the paths prepended to your message
(`[Attached files:\n- /…/spec.md]\n\n review this spec`); the stored user message
keeps the raw text and shows the attachment in the desktop app.

If the file is already on the machine (e.g. the driver wrote it into the
worktree), you can skip the upload and just reference its path in `attachments`
or mention it in `text` — no upload needed.

## Example (curl)

```bash
TOKEN=... ; BASE=http://127.0.0.1:6767
auth="Authorization: Bearer $TOKEN"

# 1. Pick a project
PROJECT=$(curl -s -H "$auth" $BASE/api/v1/projects | jq -r '.data[0].id')

# 2. Create a workspace
WS=$(curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d '{"branch":"api-smoke-test"}' \
  $BASE/api/v1/projects/$PROJECT/workspaces | jq -r '.data.id')

# 3. Start a session
SESSION=$(curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d '{"label":"driven by curl"}' \
  $BASE/api/v1/workspaces/$WS/sessions | jq -r '.data.sessionId')

# 4. Send a message
curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d '{"text":"create a file HELLO.md that says hi"}' \
  $BASE/api/v1/sessions/$SESSION/messages

# 5. Poll for the reply
curl -s -H "$auth" "$BASE/api/v1/sessions/$SESSION/messages?view=text&sinceSeq=0"
```

## Implementation

Lives in `crates/overseer-http/src/api_v1/`:

- `mod.rs` — router, response envelope, and resolving a session/workspace id to
  its on-disk location via the project registry.
- `workspaces.rs` — list projects, create a workspace (git worktree +
  `projects.json` entry).
- `sessions.rs` — create a session (writes chat metadata + sidebar index), read
  session status.
- `messages.rs` — send a message (persists it, then spawns/continues Claude), read
  messages with a poll cursor.
- `views.rs` — folds the persisted event stream into the `text` / `full` message
  views, using the same tool-call classification as the desktop UI
  (`parseToolCall.ts`).

It reuses the existing core managers: `overseer_core::git::add_workspace`,
`ChatSessionManager` (register / add message / load events by sequence), and
`ClaudeAgentManager::send_message`. Because it writes the same files as the desktop
app, no frontend changes are needed — driven work shows up in the UI automatically.
