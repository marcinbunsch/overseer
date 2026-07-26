# Overseer Driving API — client reference

This is the HTTP API a client uses to drive Overseer: create a workspace in a
project, start a session, send messages to the coding agent, and read its
replies. The client is the driver; the coding agent (Claude) does the work.
Every message is stored the same way the desktop app stores it, so a person can
open the same session later and see the whole conversation.

This document is everything you need to write a client. You don't need to know
anything about Overseer's internals.

## Before you start

1. Open the Overseer desktop app.
2. Go to **Settings → Advanced** and start the HTTP server. Note the host and
   port (default `127.0.0.1:6767`).
3. If authentication is on, copy the token shown there. Send it on every request
   as an `Authorization: Bearer <token>` header.

The server only accepts local connections by default. To reach it from another
machine, bind it to your network or put it behind a VPN — that's a server
setting, not part of this API.

Only the Claude agent is supported right now.

## The basics

- Base URL: `http://<host>:<port>` (e.g. `http://127.0.0.1:6767`).
- All request bodies are JSON, except the file upload, which is raw bytes.
- Every response is JSON in the same envelope:
  - Success: `{ "success": true, "data": <result> }`
  - Failure: `{ "success": false, "error": "<message>" }`
- Status codes:
  - `200` — success.
  - `400` — your request was malformed (a required field is missing, or `view`
    is not `text`/`full`).
  - `401` — the auth token is missing or wrong.
  - `404` — the project, workspace, or session doesn't exist.
  - `500` — something failed on the server (the `error` says what).

## The normal flow

1. List projects and pick one.
2. Create a workspace in that project. You get a `workspaceId`.
3. Start a session in that workspace. You get a `sessionId`.
4. Send a message. This returns straight away — it does **not** wait for the
   agent to reply.
5. Read messages in a loop, passing back the last sequence number you saw, until
   the reply is done.
6. Send the next message to continue the same session.

Steps 4–6 repeat for as long as you want to keep talking to the agent.

## Endpoints

### List projects

```
GET /api/v1/projects
```

Returns the projects you can create workspaces in.

```json
{ "success": true, "data": [ { "id": "proj-1", "name": "overseer", "path": "/Users/me/code/overseer" } ] }
```

### Create a workspace

```
POST /api/v1/projects/{projectId}/workspaces
```

Creates a git worktree on a new branch and records it so it shows up in the
desktop app.

Request body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `branch` | string | yes | Branch name for the new workspace. |

Response `data`:

```json
{ "id": "ws-abc", "projectId": "proj-1", "name": "dugong", "branch": "my-feature", "path": "/Users/me/overseer/workspaces/overseer/dugong" }
```

`name` is the workspace's folder name. `path` is the absolute directory the agent
works in.

### Start a session

```
POST /api/v1/workspaces/{workspaceId}/sessions
```

Request body (all optional):

| Field | Type | Default | Notes |
|---|---|---|---|
| `label` | string | `"API session"` | Shown as the chat title in the desktop app. |
| `modelVersion` | string | agent default | Claude model alias, e.g. `sonnet`, `opus`, `haiku`. |
| `permissionMode` | string | `bypassPermissions` | How tool approvals are handled (see below). |

Response `data`:

```json
{ "sessionId": "sess-xyz" }
```

**Permission mode.** By default a session runs in `bypassPermissions`, so the
agent never stops to ask a human to approve a command — the right choice when a
machine is driving. Other modes (`default`, `acceptEdits`, `plan`) exist but will
pause the agent waiting for an approval this API doesn't yet let you answer, so
leave the default unless you know you want a pause.

### Get session status

```
GET /api/v1/sessions/{sessionId}
```

Response `data`:

```json
{ "sessionId": "sess-xyz", "workspaceId": "ws-abc", "label": "API session", "agentType": "claude", "running": false, "lastSeq": 12 }
```

- `running` — true while the agent's process is working on a turn.
- `lastSeq` — the highest message sequence number stored so far.

### Send a message

```
POST /api/v1/sessions/{sessionId}/messages
```

Persists your message and starts (or continues) the agent. **Returns
immediately** — the reply arrives later; read it by polling (next endpoint).

Request body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | Your message to the agent. |
| `attachments` | array | no | Files to attach (see [Attaching files](#attaching-files)). |

Response `data`:

```json
{ "accepted": true, "lastSeq": 5 }
```

`lastSeq` is the sequence number of your message. Use it as the `sinceSeq` when
you poll for the reply.

### Read messages

```
GET /api/v1/sessions/{sessionId}/messages?view=text&sinceSeq=5
```

Query parameters:

| Param | Type | Default | Notes |
|---|---|---|---|
| `view` | `text` \| `full` | `text` | How much detail to return (see below). |
| `sinceSeq` | integer | none | Return only messages after this sequence number. Omit to get everything. |

Response `data`:

```json
{
  "messages": [ { "seq": 6, "role": "assistant", "text": "Done — created HELLO.md." } ],
  "lastSeq": 7,
  "running": false,
  "turnComplete": true
}
```

- `messages` — the messages selected by `view` (see the message shape below).
- `lastSeq` — the highest sequence number covered by this response. Pass it as
  `sinceSeq` on your next poll.
- `running` — true while the agent is still working.
- `turnComplete` — true once the agent finished the turn. **This is your signal
  to stop polling.**

**Views.**

- `text` (default) — only the conversation: your messages and the agent's text
  replies. No thinking, no tool calls, no command output.
- `full` — everything the desktop app shows: adds the agent's thinking, its tool
  calls, tool results, and command output.

### Attaching files

See [Attaching files](#attaching-files) below.

## The message shape

Each item in `messages`:

| Field | Type | Always present | Notes |
|---|---|---|---|
| `seq` | integer | yes | The message's sequence number. |
| `role` | string | yes | `user`, `assistant`, or `tool`. |
| `text` | string | yes | The message text. |
| `kind` | string | no | Only in `full`. One of `thinking`, `tool`, `toolResult`, `bashOutput`. Absent means a plain text message. |
| `toolName` | string | no | For a tool call, the tool's name (e.g. `Bash`, `Edit`). |
| `isError` | boolean | no | For a tool result, true if it failed. |

In the `text` view you only ever see `role: "user"` (your messages) and
`role: "assistant"` with no `kind` (the agent's replies).

## How to wait for a reply

Send returns immediately, so poll until the turn is done:

1. `POST .../messages` with your text. Remember the `lastSeq` it returns.
2. `GET .../messages?view=text&sinceSeq=<lastSeq>`.
3. Add any returned messages to your record and update `lastSeq` from the
   response.
4. If `turnComplete` is `false`, wait about a second and go back to step 2.
5. When `turnComplete` is `true`, the agent is done. The last `assistant` message
   is the reply.

Pseudocode:

```
send = POST /messages { "text": "..." }
cursor = send.data.lastSeq
loop:
    r = GET /messages?view=text&sinceSeq=<cursor>
    record r.data.messages
    cursor = r.data.lastSeq
    if r.data.turnComplete: break
    sleep 1s
reply = last message in record with role == "assistant"
```

## Attaching files

Attaching a file means storing it and letting the agent read it from disk. Two
steps:

1. Upload the bytes:

   ```
   POST /api/v1/sessions/{sessionId}/attachments?filename=spec.md
   ```

   The request body is the raw file content (not JSON). Response `data`:

   ```json
   { "id": "att-1", "filename": "spec.md", "path": "/Users/me/.config/overseer/attachments/att-1/spec.md", "mimeType": "text/markdown", "size": 1234 }
   ```

   The upload limit is 32 MiB.

2. Reference it when you send a message. Put the object (or at least its `path`)
   in the `attachments` array:

   ```json
   { "text": "review this spec", "attachments": [ { "path": "/Users/me/.config/overseer/attachments/att-1/spec.md" } ] }
   ```

The agent receives the file paths in front of your message, so it opens and reads
them. The stored message keeps your raw text and shows the file in the desktop
app.

If the file is already on the machine — for example your client wrote it into the
workspace — you can skip the upload and just pass its path in `attachments`, or
mention the path in `text`.

## Full example (curl)

```bash
TOKEN=...                      # from Settings -> Advanced
BASE=http://127.0.0.1:6767
auth="Authorization: Bearer $TOKEN"

# 1. Pick a project.
PROJECT=$(curl -s -H "$auth" $BASE/api/v1/projects | jq -r '.data[0].id')

# 2. Create a workspace.
WS=$(curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d '{"branch":"api-demo"}' \
  $BASE/api/v1/projects/$PROJECT/workspaces | jq -r '.data.id')

# 3. Start a session.
SESSION=$(curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d '{"label":"driven by curl"}' \
  $BASE/api/v1/workspaces/$WS/sessions | jq -r '.data.sessionId')

# 4. (Optional) Upload a file to attach.
ATT=$(curl -s -H "$auth" --data-binary @spec.md \
  "$BASE/api/v1/sessions/$SESSION/attachments?filename=spec.md" | jq -c '.data')

# 5. Send a message (with the attachment).
curl -s -H "$auth" -H 'Content-Type: application/json' \
  -d "{\"text\":\"read spec.md and create HELLO.md\",\"attachments\":[$ATT]}" \
  $BASE/api/v1/sessions/$SESSION/messages

# 6. Poll until the turn is done, then read the reply.
curl -s -H "$auth" "$BASE/api/v1/sessions/$SESSION/messages?view=text&sinceSeq=0"
```

## Notes and limits

- Claude only. Other agents are not available over this API yet.
- Sessions default to `bypassPermissions`, so the agent runs without stopping for
  approvals. There is no way yet to answer an approval or a plan/question prompt
  through this API; if one appears you'll see it in the `full` view.
- Upload limit is 32 MiB per file.
- Sequence numbers only ever grow within a session; use them as your read cursor.
