# Fix: Claude reports "done" while a background Agent is still running

## Problem

When Claude uses the **`Agent` tool** (a background subagent, `task_type: local_agent`),
Overseer marks the turn complete too early, then keeps streaming the subagent's output
after the "done" marker. It also throws the subagent's work away. The user's words:
"finishing too early, reporting being done and then streaming stuff — it works like garbage."

### Evidence

Traced from a real session (`~/.config/overseer/chats/cases/xerus/51d5aa36-….jsonl`
and the raw `.log`). Background-task lifecycle from the CLI stream-json:

```
12:30:52.266  assistant tool_use  name=Agent  id=toolu_01Bsq…      (background launch)
12:30:52.272  system  subtype=task_started        task_id=a848…  tool_use_id=toolu_01Bsq…
12:30:52.272  system  subtype=background_tasks_changed  tasks=[{task_id:a848…}]
12:30:52.274  user    tool_result for toolu_01Bsq…               (returns immediately: "started")
12:30:55.100  result  subtype=success                            ← turn "ends" here
12:30:58…31:00  assistant tool_use Bash  parent_tool_use_id=toolu_01Bsq…  (agent still working)
12:32:19      system  subtype=task_notification  task_id=a848…  status=stopped
```

### Root cause

`crates/overseer-core/src/agents/claude/parser.rs:488` maps **every** `type:"result"`
to `AgentEvent::TurnComplete`. A background agent returns a `tool_result` immediately and
the launching turn emits `result` while the agent keeps running. That `result` should not
end the turn.

Two symptoms fall out of this:

1. **UX** — Overseer fires `TurnComplete` at the first `result`: notifications play, the
   chat goes idle, then the background agent's tool calls stream in *after* the "done"
   marker.
2. **Correctness** — because the chat looks idle, the turn ends and (on the next user
   message / config change) the process is torn down and restarted with `--resume`. That
   orphans the still-running background agent; its result is never recorded
   (`task_notification … status=stopped`, "running when the previous Claude Code process
   exited"). Next turn Claude notices "the background agent didn't finish" and redoes the
   whole search inline — wasted work.

### Why the parser is the right fix point

Overseer runs the CLI in streaming mode (`--output-format stream-json --input-format
stream-json --verbose`, **no** `--print`; see `crates/overseer-core/src/agents/claude/spawn.rs`).
The process stays alive across turns, reading stdin. The background agent runs inside that
live process. It only gets orphaned because Overseer treats the early `result` as
turn-end and tears the process down. If we **don't** emit `TurnComplete` while a background
task is active:

- `isSending` stays `true` in `ChatStore.ts`, so the chat stays "running" — no early
  notification, no idle status.
- The `turnComplete`-driven restart / `_configChanged` teardown never runs mid-task.
- The live stdin process keeps the background agent alive.

So gating `TurnComplete` in the parser fixes both symptoms.

## Plan

### Change 1 — Parser tracks background tasks

File: `crates/overseer-core/src/agents/claude/parser.rs`

Add state to `ClaudeParser`:

```rust
active_bg_tasks: std::collections::HashSet<String>,  // running task_ids
pending_turn_complete: bool,                          // a `result` arrived while tasks active
```

Change `translate_event(&self, …)` → `translate_event(&mut self, …)` (only caller is
`parse_line`, already `&mut self`).

New `system` subtype arms (alongside the existing `status` / `compact_boundary`):

- `task_started` → `active_bg_tasks.insert(task_id)`; emit nothing.
- `background_tasks_changed` → replace `active_bg_tasks` with the event's `task_id`s
  (authoritative resync); then run the drain check below.
- `task_notification` → `active_bg_tasks.remove(task_id)`; then run the drain check.

**Drain check** (helper): if `active_bg_tasks` is now empty and `pending_turn_complete`,
set `pending_turn_complete = false` and emit `AgentEvent::TurnComplete`.

Change the `result` arm:

```rust
"result" => {
    if self.active_bg_tasks.is_empty() {
        vec![AgentEvent::TurnComplete]
    } else {
        self.pending_turn_complete = true;
        Vec::new()                    // defer — completion fires when tasks drain
    }
}
```

### Change 2 — Deserialize the task fields

File: `crates/overseer-core/src/agents/claude/types.rs`

`ClaudeStreamEvent` already has `subtype` and `status`. Add:

- `task_id: Option<String>` (top-level; used by `task_started` / `task_notification`)
- `tasks: Option<Vec<BackgroundTask>>` where `BackgroundTask { task_id: String }`
  (other fields ignored)

### Change 3 — Confirm no teardown fires during suppression

No expected code change. During implementation, re-read the `Done` handler and the
`_configChanged` path in `ChatStore.ts` to confirm nothing stops the process while
`active_bg_tasks` is non-empty. `Done` (emitted on real process exit,
`claude_agent.rs:327`) remains the fallback turn-end if a task never sends a terminal
notification.

### Change 4 — Tests

`parser.rs` unit tests:

- `result` with an active background task → **no** `TurnComplete`.
- `task_notification` draining the last task after a deferred `result` → emits `TurnComplete`.
- `result` with no active tasks → still emits `TurnComplete` (regression guard).
- two tasks: `TurnComplete` fires only after **both** notifications.
- `background_tasks_changed` resync sets the active set; draining to `[]` then a `result`
  with empty set completes normally.
- `task_notification` arriving *before* `result` (agent finishes fast) → `result` still
  completes normally.

Run: `cargo test -p overseer-core`, `pnpm test`, and `cargo check`.

## Known limitation

If a background task never sends a terminal `task_notification` (e.g. the process is
killed), the parser won't emit the deferred `TurnComplete` — but the `Done` event on
process exit already unblocks the UI.

## Optional follow-up (not in this cut)

Emit a lightweight info message when a background task starts ("Background agent
running: …") so the still-running state is obvious while the turn stays open. Left out to
keep scope tight; the `Agent` tool_use message already renders in the work section.
