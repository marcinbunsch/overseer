# Pi RPC — Interactive Prompts / Dialogs

Research notes on how the Pi coding agent asks the user questions over its RPC
protocol, and how a client (Overseer) must respond. Verified against the Pi
source (`pi/` clone, `packages/coding-agent`) and Pi 0.80.3.

## TL;DR

- Interactive prompts are **not** delivered as `AgentEvent`s. They come from Pi's
  **extension UI sub-protocol**: a top-level stdout line with
  `type: "extension_ui_request"`.
- A "dialog" request (`select`, `confirm`, `input`, `editor`) **blocks the tool's
  execution** until the client writes a matching `extension_ui_response` to stdin.
  If the client never responds, Pi hangs on that tool forever (unless the request
  carried a `timeout`, which auto-resolves to `undefined`).
- "Fire-and-forget" requests (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`) expect **no** response.

## Where it comes from

`ask_user_question` is **not** a Pi built-in. It's a user extension at
`~/.pi/agent/extensions/ask-user-question.ts`:

```ts
pi.registerTool({
  name: "ask_user_question",
  label: "Ask User Question",
  parameters: Type.Object({
    question: Type.String(),
    options: Type.Array(Type.String(), { minItems: 1 }),
  }),
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const selection = await ctx.ui.select(params.question, params.options)
    return { content: [{ type: "text", text: `The user chose: ${selection}` }],
             details: { choice: selection } }
  },
})
```

`ctx.ui.select(title, options)` is what triggers the `extension_ui_request`.
Any extension using `ctx.ui.*` behaves the same way — the tool name is
irrelevant; what matters is the `extension_ui_request` on stdout.

## Event sequence for `ask_user_question`

```
{"type":"tool_execution_start","toolCallId":"...","toolName":"ask_user_question",
 "args":{"question":"Which planet...","options":["Venus","Mars","Jupiter"]}}
{"type":"extension_ui_request","id":"<uuid>","method":"select",
 "title":"Which planet...","options":["Venus","Mars","Jupiter"]}
        <-- Pi BLOCKS here waiting for stdin -->
   (client writes) {"type":"extension_ui_response","id":"<uuid>","value":"Mars"}
{"type":"tool_execution_end","toolCallId":"...","toolName":"ask_user_question",
 "result":{"content":[{"type":"text","text":"The user chose: Mars"}],
           "details":{"choice":"Mars"}},"isError":false}
```

Note the `tool_execution_start` and the `extension_ui_request` are **two separate
stdout lines** with no shared id — correlate the dialog by its own `id`, and the
tool by `toolCallId`.

## Request shapes (stdout → client)

All have `type: "extension_ui_request"`, a unique `id`, and a `method`.

### `select` (the one `ask_user_question` uses)
```json
{ "type":"extension_ui_request","id":"uuid","method":"select",
  "title":"Allow dangerous command?","options":["Allow","Block"],"timeout":10000 }
```
Response: `value` (chosen option string) **or** `cancelled: true`.

### `confirm`
```json
{ "type":"extension_ui_request","id":"uuid","method":"confirm",
  "title":"Clear session?","message":"All messages will be lost.","timeout":5000 }
```
Response: `confirmed: true|false` **or** `cancelled: true`.

### `input`
```json
{ "type":"extension_ui_request","id":"uuid","method":"input",
  "title":"Enter a value","placeholder":"type something..." }
```
Response: `value` (entered text) **or** `cancelled: true`.

### `editor`
```json
{ "type":"extension_ui_request","id":"uuid","method":"editor",
  "title":"Edit text","prefill":"Line 1\nLine 2" }
```
Response: `value` (edited text) **or** `cancelled: true`.

### Fire-and-forget (no response)
`notify` (`message`, `notifyType: info|warning|error`), `setStatus`,
`setWidget`, `setTitle`, `set_editor_text`.

## Response shapes (client → stdin)

Write a single JSON line (Pi already expects `\n`-delimited JSON on stdin, same
channel used for `prompt`/`abort`/`set_model` commands — see Overseer's
`pi_stdin` command and `PiAgentService.sendCommand`):

```json
{ "type":"extension_ui_response","id":"<matching id>","value":"Mars" }   // select/input/editor
{ "type":"extension_ui_response","id":"<matching id>","confirmed":true }  // confirm
{ "type":"extension_ui_response","id":"<matching id>","cancelled":true }  // any: user dismissed
```

`timeout` (when present) is in ms; if the client doesn't respond in time Pi
auto-resolves the dialog to `undefined` and continues.

## Source references (in the `pi/` clone)

- RPC dialog protocol + shapes: `packages/coding-agent/docs/rpc.md` (§ "Extension UI Requests")
- RPC UI context + pending-request map: `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- Request/response types: `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- Extension UI context interface: `packages/coding-agent/src/core/extensions/types.ts`

## Overseer mapping (select-only)

`ctx.mode === "rpc"` guards TUI-only `custom()`; `select/confirm/input/editor`
are all functional over RPC. Overseer currently implements **select only**:

- Rust `PiParser` detects `type:"extension_ui_request"`, `method:"select"` and
  emits `AgentEvent::Question` (reusing the existing question UI). The dialog
  `id` becomes the question `request_id`; `title` → question text; `options` →
  option labels; `multi_select: false`.
- `PiAgentService.sendToolApproval` translates the answer into
  `{"type":"extension_ui_response","id":requestId,"value":<chosen>}` (or
  `{"cancelled":true}` on deny) and writes it via `sendCommand` (`pi_stdin`).
- Other methods (`confirm`/`input`/`editor`/`notify`) are **not** handled yet —
  Pi would block on those until timeout. Add them later if needed.
</content>
