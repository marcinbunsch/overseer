# Fix: background task completion fires the main turn's TurnComplete

## Status

`be5cd1c "Defer turn completion while a background Agent runs"` is already shipped and is
the source of the current bug. This plan replaces that approach's task-tracking with one
that only tracks real background **agents**, not background Bash tasks.

## Problem

The user: "agents finishing are triggering turn complete for the main turn." A background
task finishing (including a background `pnpm checks` Bash run) fires the launching turn's
`TurnComplete`.

## What the CLI actually emits

Traced from `~/.config/overseer/chats/cases/archived/bu-assignment-results-…/51d5aa36-….log`
(the raw stream-json, prefixed `[ts] STDOUT:`).

**Two different things both use `task_started` / `task_notification`:**

1. **A background `Agent` tool** (`task_type: "local_agent"`). 16-hex id. It ALSO emits a
   `background_tasks_changed` carrying `task_type` and a description:
   ```
   12:30:52  assistant tool_use Agent
   12:30:52  system background_tasks_changed  tasks=[{task_id:a848ca4aa9b7d8fca, task_type:"local_agent", description:"Find grading scalar recalculation logic"}]
   12:30:52  system task_started  task_id=a848ca4aa9b7d8fca
   ```

2. **A background Bash command** (e.g. `pnpm checks` with `run_in_background`). Short id
   (`b92gx6e23`). It emits ONLY bare `task_started` / `task_notification` — **no**
   `background_tasks_changed`, **no** `task_type`:
   ```
   12:40:34  system task_started       task_id=b92gx6e23
   12:40:49  system task_notification  task_id=b92gx6e23  status=completed
   12:41:06  system task_started       task_id=bqh1ozud9
   12:41:35  system task_notification  task_id=bqh1ozud9  status=completed
   12:41:47  result success num_turns=43        ← the turn's real end
   ```
   Here the main assistant (`parent_tool_use_id` absent) runs continuously THROUGH both
   background Bash tasks and ends only at the trailing `result`.

**`background_tasks_changed` fires only on agent START, not on finish.** It appears once
(12:30:52, tasks=1) and never again — not when the agent stops. So the agent-finished
signal is `task_notification` with the agent's id, not a `background_tasks_changed` back
to empty.

## Root cause

`crates/overseer-core/src/agents/claude/parser.rs`, the `task_started` arm (line 682):

```rust
"task_started" => {
    if let Some(ref task_id) = event.task_id {
        self.active_bg_tasks.insert(task_id.clone());   // inserts EVERY task, incl. Bash
    }
    return Vec::new();
}
```

`task_started` carries no `task_type`, so this inserts background **Bash** ids into
`active_bg_tasks`. Then the `task_notification` arm (line 700) removes them and calls
`drain_turn_complete()`, which fires `TurnComplete` when the set empties and a `result`
was pending. Net: a background `pnpm checks` finishing fires the main turn's completion.

(Secondary: the real main-turn `result` at 12:30:55, num_turns=2 — the assistant answered
and detached a research agent — gets suppressed as "premature." Under the chosen behavior
below that suppression is correct, but only for real agents.)

## Chosen behavior

**Stay running until the background agent finishes.** From the moment the assistant
answers and detaches a `local_agent`, the chat stays "running"; `TurnComplete` fires once,
when the last running agent finishes. Only `task_type: "local_agent"` tasks count.
Background Bash tasks never affect turn completion.

## Plan

### Change 1 — Deserialize `task_type`

File: `crates/overseer-core/src/agents/claude/types.rs`

`BackgroundTask` currently has only `task_id`. Add:

```rust
#[serde(default)]
pub task_type: Option<String>,
```

### Change 2 — Track only agents, drive the set from `background_tasks_changed`

File: `crates/overseer-core/src/agents/claude/parser.rs`

`background_tasks_changed` is the only event that carries `task_type`, so it is the source
of truth for which ids are agents. Keep a set of agent ids learned from it.

- **`background_tasks_changed`** — insert every `task_id` whose `task_type == "local_agent"`
  into `active_bg_tasks`. (Union, not replace: the event fires on start and lists the
  agents that just launched. It never fires on finish, so replacing would be a no-op for
  draining anyway; union is simpler to reason about with sequential launches.) Emit nothing.

- **`task_started`** — remove the insert entirely. `task_started` can't be classified
  (no `task_type`); we learn agent ids from `background_tasks_changed` instead. Emit nothing.

- **`task_notification`** — only act if `task_id` is in `active_bg_tasks` (i.e. it's an
  agent). Remove it, then run the drain check. If the id isn't tracked (background Bash),
  ignore the event entirely — no drain, no completion.

- **`result`** — unchanged shape: if `active_bg_tasks` is empty → `TurnComplete`; else set
  `pending_turn_complete = true` and emit nothing (suppress the premature result while an
  agent runs).

- **`drain_turn_complete`** — unchanged: if the agent set is empty and a result was
  pending, fire `TurnComplete` once and clear the pending flag.

Net effect on the traced session:
- 12:40 / 12:48 / … background Bash tasks: `task_started` no longer tracks them;
  `task_notification` finds them absent from the agent set and ignores them. The main turn
  completes only at its trailing `result`. ✓
- 12:30 background agent: `background_tasks_changed` records `a848…` as a `local_agent`;
  the 12:30:55 `result` is suppressed (agent active); the chat stays running; when the
  agent's `task_notification` removes `a848…`, the drain fires one `TurnComplete`. ✓

### Change 3 — Tests

`parser.rs` unit tests:

- Background Bash lifecycle (`task_started`/`task_notification`, short id, **no**
  `background_tasks_changed`) while a `result` is pending → does NOT fire `TurnComplete`.
  Guards the reported bug.
- `background_tasks_changed` with `task_type:"local_agent"` then a `result` → suppressed
  (no completion). Then `task_notification` for that id → fires one `TurnComplete`.
- `result` with no tracked agents → fires `TurnComplete` (regression guard).
- Two agents in one `background_tasks_changed` (tasks=[a,b]) → `TurnComplete` fires only
  after both `task_notification`s.
- Mixed: agent + background Bash both "running"; the Bash `task_notification` fires first
  → no completion; the agent `task_notification` fires → completion.

Run: `cargo test -p overseer-core`, `pnpm test`, `cargo check` (set `CARGO_HOME=/tmp` under
sandbox).

## Known limitations

- **Sequential agents with a premature result between them.** If a turn detaches agent A,
  yields a `result` (pending), A finishes (drain fires `TurnComplete`), then the assistant
  detaches agent B, the turn completes early. Not observed in the traced data (the one
  natural agent case was interrupted by the user before it finished). Accepting this;
  revisit if it shows up.
- **Same-turn trailing result after drain.** If a natural agent completion drains and
  fires `TurnComplete`, and the CLI then emits a trailing `result` for the same turn
  (empty set → `result` arm fires again), that double-fires. Whether a natural completion
  produces a trailing result is unconfirmed (the traced trailing result at 12:32:21
  belonged to the user's "please continue" turn). If double-completion causes a visible
  problem, make the `Done`/`TurnComplete` handling idempotent in `ChatStore.ts`.
- If an agent never sends a terminal `task_notification`, the deferred `TurnComplete` never
  fires; the `Done` event on process exit remains the fallback.
