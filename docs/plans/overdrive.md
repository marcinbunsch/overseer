# Overdrive

Overdrive lets Overseer pick up work on its own: the user maintains a local task ledger, a scheduler pops tasks off the queue (e.g. overnight), each task runs as an autonomous session in a fresh workspace, and every run must prove itself with a **machine-verified harness** before landing in a review inbox. Nothing merges — and nothing even leaves the machine — without human approval.

Overdrive runs **entirely in Rust (`overseer-core`)**, headless-first. The primary deployment target is `overseer-daemon` on a server with no frontend attached; the user observes, reviews, and approves via the web interface (or the Tauri desktop app — both are dumb renderers of the same engine).

Status: **design approved, not yet implemented**.

## Vision

> I write down tasks during the day. Overnight, a server running overseer-daemon works through them one at a time — each in its own workspace, each verified by tests it had to write first — and in the morning I open the web UI to an inbox of reviewed-and-green branches with evidence attached. From my phone, if I feel like it.

Overdrive is one step beyond [Autonomous Mode](../features/autonomous-mode.md): autonomous mode loops on a task the user *starts, with the frontend attached*; Overdrive also decides *when to start* and *what to work on*, adds a verification contract, and requires no frontend at all.

## Design Decisions (locked)

These were decided explicitly during design; changing them needs a deliberate revisit.

1. **Fully headless, fully in Rust.** The entire engine — ledger, scheduler, iteration loop, harness runner, run records — lives in `overseer-core` and runs without any frontend connected. Frontends (Tauri, web via daemon) are pure observers/controllers over REST + WebSocket. **The frontend autonomous mode implementation (`ChatStore.startAutonomousRun`) is not reused** — its *design* (fresh context per iteration, files-as-memory, review-gated completion) is ported; its code is not.
2. **Local ledger is the source of truth.** Tasks live in a local, user-editable queue with its own UI. No tracker integration in the critical path. Notion/Linear become a *sync layer* later (an agent that imports tickets into the ledger); the ledger remains authoritative.
3. **Interval scheduler from day one** (plus a manual "run next task" trigger). A `tokio` interval in core — runs identically under the daemon and the desktop app.
4. **Runs stop at a local branch.** The worker commits locally and writes a summary. No push, no PR, no ticket comments. Nothing leaves the machine until the user approves. ("The machine" may be a server; the point is nothing reaches shared remotes.)
5. **One run in flight, globally.** Simple state machine, easy to babysit, cheap on tokens.
6. **Backpressure, configurable.** If more than N runs (default 3) sit in `needs-review`, the scheduler pauses picking new work.
7. **Workers run in YOLO mode.** Required for unattended operation; per-agent YOLO values (Claude `bypassPermissions`, Codex `never`, Gemini `yolo`) mirror what autonomous mode established — this mapping moves into core. The safety boundary is the disposable workspace + the human gate at merge, not permission prompts.
8. **Per-repo Overdrive prompt.** A repo-settings field ("Overdrive instructions") injected into every worker run — this is where the user bounds how wild the agent can go (dependencies, migrations, style, risk appetite).
9. **Verification is observed, not claimed.** The proof of success is an exit code from a process *the core harness runner* spawned — never prose in the agent's summary. See "Verification Harness" below; this is the core of the feature.

## Architecture

Builds directly on the [Rust core migration](rust-core-migration-plan.md): `overseer-core` already contains agent spawning + protocol parsers (all agents), the chat session manager + persistence, approval auto-decisions, git worktree/merge operations, the event bus, and overseer-actions block parsing. `overseer-daemon` already serves the embedded frontend over HTTP/WS with bearer auth. Overdrive is a new core module orchestrating those pieces.

```
crates/overseer-core/src/overdrive/
├── mod.rs         OverdriveManager, hung off OverseerContext
├── ledger.rs      task queue: CRUD, ordering, persistence (tasks/{repo}.json)
├── scheduler.rs   tokio interval, eligibility, backpressure, single-flight
├── run.rs         run state machine + run record persistence (overdrive-runs.json)
├── iterator.rs    the impl→review loop: fresh chat session per iteration,
│                  drives the existing chat_sessions manager, awaits turn
│                  completion via the core event bus, checks completion marker
└── harness.rs     set_verification handling, red/green command runner
                   (exit codes + output capture), harness snapshot + drift
```

Key structural points:

- **The orchestrator is a core citizen, not a client.** `iterator.rs` drives the same session managers the frontends use and subscribes to the same event bus. No WebSocket, no frontend, no IPC in the loop.
- **Overseer actions split.** `set_verification` and `report_result` are parsed by the existing core `overseer_actions` module but **executed in core** by the OverdriveManager (unlike `rename_chat`/`open_pr`, which remain frontend-executed). Core gains an action-execution hook for run-scoped actions.
- **Both frontends get it for free.** Tauri and the daemon both construct `OverseerContext`; the same engine runs on a desktop or a server. Desktop users get Overdrive without running a daemon.
- **Approve/reject are core git ops** (merge, archive worktree) — they work headless, invoked over the HTTP API.
- **Agent CLIs must be installed on the host running the engine** (server for daemon deployments). Nothing new — same requirement the daemon already has for normal chats.

### HTTP API (daemon + Tauri-served web)

REST (all under existing auth):

- `GET/POST/PATCH/DELETE /api/overdrive/tasks` — ledger CRUD + reorder
- `GET /api/overdrive/runs` — run list (inbox), with evidence
- `POST /api/overdrive/runs/:id/approve` — merge flow
- `POST /api/overdrive/runs/:id/reject` — archive workspace
- `POST /api/overdrive/run-next` — manual trigger
- `GET/PATCH /api/overdrive/settings` — global + per-repo config

WebSocket: `overdrive:run-status` events (run id, old → new status, evidence delta). The web UI's inbox and badges are driven purely by these; the run's chat is observable live through the existing chat WS streaming.

Tauri exposes the same operations as commands wrapping the manager — same code path, different transport.

## Relationship to Autonomous Mode

| Concern | Autonomous Mode (existing) | Overdrive |
|---|---|---|
| Where the loop runs | Frontend (`ChatStore.ts`, MobX) | `overseer-core` (Rust) |
| Trigger | User clicks "Autonomous Run" | Scheduler / manual run-next |
| Fresh context per iteration | ✅ | ✅ (same design, new implementation) |
| Files as memory (`autonomous-*.md`) | ✅ | ✅ (`overdrive-prompt.md`, `overdrive-progress.md`, `overdrive-review.md`) |
| Review-gated completion marker | `AUTONOMOUS_SESSION_COMPLETE` | `OVERDRIVE_RUN_COMPLETE` |
| YOLO forcing | `getYoloModeValueForAgent()` (TS) | Same mapping, in core |
| Verification | Review step's judgment | Machine-run harness (exit codes) + review |
| Needs frontend attached | Yes | No |

The existing frontend autonomous mode stays as-is for now. Once Overdrive's iterator is solid, desktop autonomous mode *could* be reimplemented on top of it (out of scope for v1).

## Data Models

```rust
enum TaskStatus { Todo, Running, NeedsReview, Done, Failed, Rejected }

struct OverdriveTask {
    id: String,
    repo_id: String,
    title: String,
    description: String,
    /// Optional user-authored verification criteria. When present, the harness
    /// phase MUST honor it. When absent, the agent proposes the harness.
    verification: Option<String>,
    /// Refactor-type tasks where the harness is expected to be green from the
    /// start (criteria = suite stays green + review passes). Skips the red check.
    expect_green_harness: bool,
    status: TaskStatus,
    /// Queue position; top of the list runs first.
    order: u32,
    created_at: DateTime<Utc>,
    run_ids: Vec<String>,
    /// Future sync layer: e.g. "linear:OVR-123". Unused in v1.
    source_ref: Option<String>,
}

enum RunStatus {
    Provisioning,  // creating workspace + chat
    Harness,       // building + registering verification
    RedCheck,      // harness runner executing, expecting failure
    Working,       // impl→review loop
    FinalVerify,   // harness runner executing, expecting success
    NeedsReview,   // green; waiting for human
    NeedsInput,    // agent asked a question; paused (timeout applies)
    Approved,      // human approved (merge flow)
    Rejected,      // human rejected (workspace archived)
    Failed,        // budget exceeded, thrash limit, or unrecoverable error
    Interrupted,   // engine restarted mid-run
}

struct VerificationEvidence {
    commands: Vec<String>,
    /// Results of engine-executed checks.
    red_check: Option<CheckResult>,    // exit codes, output excerpt, timestamp
    final_check: Option<CheckResult>,
    /// Diff of registered harness files between red check and final check.
    /// Non-empty = flagged to reviewer and human.
    harness_drift: Option<String>,
}

struct OverdriveRun {
    id: String,
    task_id: String,
    repo_id: String,
    workspace_id: Option<String>,
    chat_id: Option<String>,
    status: RunStatus,
    verification: Option<VerificationEvidence>,
    result: Option<RunResult>,          // summary + assumptions from report_result
    verify_bounces: u32,                // final-verify → working bounces
    iterations_used: u32,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    error: Option<String>,
}
```

Persistence (existing config-dir conventions; daemon `--config-dir`/`--dev` respected):

- Tasks: `~/.config/overseer[-dev]/tasks/{repo}.json`
- Runs: `~/.config/overseer[-dev]/overdrive-runs.json` (doubles as inbox history)

## Task Ledger UI

A per-repo **Tasks** view (left-pane section under the repo, alongside workspaces) — identical in the desktop app and the web UI, since both render server state:

- Add task: title + description (+ optional verification criteria, + expect-green flag)
- Edit, delete, reorder (drag; `order` field). Queue order = execution order.
- Status chips per task; click a `needs-review`/`running` task to jump to its run's workspace chat.
- Badge count on the repo for `needs-review` + `needs-input`.

This is the "write todos during the day, they run overnight" surface. Keep it fast to add a task — title + description must be enough; verification criteria optional by design.

## Scheduler

- `tokio` interval inside `OverdriveManager`, started when ≥1 repo has Overdrive enabled, stopped when none (no idle timer otherwise).
- On tick:
  1. Skip if a run is in flight (one-at-a-time; `NeedsInput` counts as in flight until answered, stopped, or timed out).
  2. Skip if `NeedsReview` count ≥ backpressure cap.
  3. Round-robin enabled repos; pop the top `Todo` task; start a run.
- Manual **"Run next task"** (button / `POST /api/overdrive/run-next`) uses the same code path, ignoring the interval.
- Interval is global (one scheduler); *eligibility* is per-repo (enable toggle). Default 15 min.
- Optional **quiet hours** window ("only start runs between 22:00–07:00") — a natural fit for a server that shares hardware with a human.

Principles note: this bends "no timers" — it is opt-in, off by default, active only when the user has enabled Overdrive somewhere, and it is user-scheduled work rather than idle polling.

## Run Lifecycle

```
todo task popped
   ↓
provisioning     create workspace (existing worktree flow) + chat titled after task
   ↓
harness          iteration 0: agent reads task, builds verification, emits set_verification
   ↓
red-check        ENGINE runs the registered commands in the workspace
   │               • expected: failure (unless task.expect_green_harness)
   │               • harness green here → bounce back to harness phase with feedback
   │               • snapshot harness files for drift detection
   ↓
working          impl→review loop (fresh session per iteration, YOLO,
   │             review-only completion) with harness-integrity mandate
   ↓  review outputs OVERDRIVE_RUN_COMPLETE
final-verify     ENGINE runs: registered commands + repo check command (e.g. pnpm test)
   │               • any red → bounce back to working (verify_bounces++, capped at 2)
   │               • compute harness_drift
   ↓  all green
needs-review     commit ensured; report_result stored; WS event + badge fired
   ↓
approved → core merge flow            rejected → core archive-workspace flow
```

Off-ramps at any stage:

- `failed` — budget/thrash/error. Workspace kept for autopsy.
- `needs-input` — agent asked a question. The question renders through the existing question UI (web or desktop); the run pauses; WS event fires. **Timeout setting** (default 4h): headless overnight queues must not stall on one question — on timeout the run fails with "blocked on input" and the scheduler moves on.
- `interrupted` — engine restart. On boot the manager marks any in-flight run `interrupted`; the chat is persisted, so the user can resume manually. No auto-resume in v1.

Budgets: max iterations per run, wall-clock cap (default 30 min), verify-bounce cap (default 2), harness-phase iteration cap (default 2).

## Verification Harness

**Core rule: the agent never gets to declare success. The engine observes it.**

Agents under a "finish the task" objective will hallucinate "all tests pass ✓". They cannot hallucinate an exit code from a process the engine spawned. Therefore:

1. **Harness first.** Before any implementation, the worker must decide how success is machine-checkable for *this* task — unit test, functional test, script, whatever fits — build it, and register it:

   ```overseer
   {"action": "set_verification", "params": {"commands": ["pnpm test src/foo/__tests__/bar.test.ts", "pnpm checks:ui"]}}
   ```

   If the task has user-authored `verification` criteria, the harness must honor them. If not, the agent proposes the harness and records its reasoning in `overdrive-progress.md` so the choice is auditable.

2. **Red check.** The engine runs the registered commands itself (`harness.rs`: spawn via the existing login-shell machinery, workspace cwd, capture exit code + output tail, per-command timeout default 10 min). For feature/bugfix tasks the harness **must fail** at this point — a harness that is green before the work exists proves nothing. (`expect_green_harness` tasks skip this: refactors where the criteria is "suite stays green".) The engine snapshots the harness files.

3. **Harness integrity.** The review iteration gets an added mandate: check the diff for gamed verification — deleted/weakened assertions, `expect(true)`, skipped tests, harness edits. Independently, the engine diffs the registered harness files against the red-check snapshot and surfaces any `harness_drift` on the evidence card. Drift is not automatically fatal (tests legitimately evolve) but it is always visible to the human.

4. **Final verify by the engine.** On completion signal, the engine re-runs the registered commands **plus** the repo's standard check command (per-repo setting, e.g. `pnpm test`) to catch regressions outside the harness. Exit codes + output excerpts are stored on the run. Red → bounce back to the loop (capped); green → `needs-review`.

5. **Evidence card.** The inbox entry for a run shows observed facts: harness commands, red-at-start ✓, green-at-end ✓ (with output), full-suite result, diffstat, harness drift, iterations used, duration — plus the agent's `report_result` summary and assumptions.

Harness vocabulary in v1 is **anything runnable as a shell command in the workspace**. GUI/e2e testing of Tauri apps (WebDriver etc.) is explicitly out of scope — its own future project.

## New Overseer Actions

Extends the [Overseer Actions protocol](../features/overseer-actions.md). Injected into Overdrive worker prompts only (not general chats). Parsed by the existing core `overseer_actions` module; **executed in core** by the OverdriveManager.

### `set_verification`

| Param | Type | Required | Description |
|---|---|---|---|
| `commands` | string[] | Yes | Shell commands whose exit codes define success |

Behavior: stores commands on the run, triggers the red check. Re-emitting replaces the registered commands **only during the harness phase**; after red check, changes are recorded as drift.

### `report_result`

| Param | Type | Required | Description |
|---|---|---|---|
| `summary` | string | Yes | What was done, human-readable |
| `assumptions` | string[] | No | Decisions made without asking |

Behavior: stored on the run record; rendered on the evidence card. Emitted by the final review iteration.

## Inbox & Review UI

Identical React components in the desktop app and the daemon-served web UI — all state comes from the engine over REST/WS.

- **Overdrive section** at the top of the left pane: cross-repo run list (task title, repo, status dot, diffstat, duration). Badge on `needs-review` / `needs-input` / `failed`. Click → navigates to the run's workspace + chat via existing selection.
- **Overdrive workspaces** get a badge in the repo tree.
- **Chat header status strip** on run chats: task title, run status, evidence summary (red→green ✓), and **Approve** / **Reject** buttons.
  - Approve → merge flow (core).
  - Reject → archive-workspace flow (core).
  - Request changes → just type in the chat; it is a live chat streaming over the existing WS. Zero new machinery.
- **Notifications**: WS event + badge everywhere; native notifications when the Tauri app happens to be attached. (Push/webhook/ntfy for pure-headless setups: future.)

## Settings

Per-repo:

- Overdrive enabled (default off)
- Overdrive instructions (the "how wild" prompt)
- Check command for final verify (default: repo's test command, e.g. `pnpm test`)
- Max iterations per run, wall-clock budget

Global:

- Scheduler interval (default 15 min), quiet hours (optional)
- Backpressure cap (default 3 unreviewed runs)
- `needs-input` timeout (default 4h)
- Agent + model for runs (default: default agent)

Stored in core-managed config so the daemon and desktop app share them; editable from either UI.

## Failure Modes & Edge Cases

- **Agent never emits `set_verification`** → after the harness-phase iteration cap, run fails with "no verification registered". No harness, no run — this is the contract.
- **Harness green at red check** → one bounce back with feedback ("your harness passes before any work; make it actually test the change"); second time, fail.
- **Final verify keeps failing** → `verify_bounces` cap (2), then `failed`. Workspace kept for autopsy.
- **Agent asks a question** → `needs-input`, existing question UI, timeout as above.
- **Engine restart mid-run** → `interrupted` on boot; chat persisted; manual resume.
- **Dirty main checkout** → irrelevant; runs happen in fresh worktrees off the base branch.
- **Task edited while running** → edits apply to future runs; the in-flight run keeps its snapshot (the prompt was already written to `overdrive-prompt.md`).
- **Two frontends watching one run** → fine by construction; both are observers of the same engine state (this is the existing shared-sessions model).

## Out of Scope for v1

- Notion/Linear/tracker sync (future: an import agent writing into the ledger; `source_ref` is reserved for it)
- GUI/e2e harnesses for Tauri apps
- Auto-push / auto-PR / auto-merge (runs stop at a local branch by decision #4)
- Concurrency > 1
- Auto-resume of interrupted runs
- Push notifications for pure-headless setups
- Reimplementing desktop autonomous mode on the Overdrive engine

## Implementation Surface (estimate)

New (Rust, `overseer-core`): `overdrive/` module (manager, ledger, scheduler, run state machine, iterator, harness runner), core-side execution hook for run-scoped overseer actions, YOLO-mapping in core, worker prompt templates.

New (HTTP): `/api/overdrive/*` routes in `overseer-http`, `overdrive:run-status` WS events, matching Tauri commands.

New (React, shared desktop/web): task ledger UI, inbox section, chat-header status strip, settings fields.

Reused: chat session managers + persistence, agent parsers, event bus, overseer-actions parser, git worktree/merge/archive, question UI, chat WS streaming, daemon binary + auth + embedded frontend.

The iterator is the meatiest new Rust in the project so far (drive a session, await turn completion via the event bus, enforce phase rules). Per house rules: built in small bites, with explanations.

## Implementation Phases

Ordered by risk, not UI visibility. Each phase lands independently.

1. **Headless turn execution spike (`iterator.rs` embryo).** The one unproven assumption in this design is "core can drive a chat session end-to-end with no frontend attached": spawn a session in a workspace, send a prompt, await turn completion via the event bus, read the final text. Build exactly that and prove it under `overseer-daemon` with zero frontends connected. If session lifecycle or turn-completion detection secretly depends on a frontend, this is where it surfaces — before anything else is built on top.
2. **Harness runner (`harness.rs`).** Pure and independently testable, no agent involved: run commands in a workspace via the login-shell machinery, capture exit codes + output, snapshot/diff harness files.
3. **Ledger + REST CRUD + minimal Tasks UI.** First user-visible slice: add/edit/reorder tasks from the web UI, before anything runs them.
4. **Run state machine.** Wire iterator + harness into the full lifecycle (provisioning → harness → red-check → working → final-verify → needs-review), the core-side `set_verification`/`report_result` action hooks, and budgets.
5. **Scheduler.** The tokio interval, single-flight, backpressure, needs-input timeout. Deliberately after the state machine: until then, runs are triggered manually via `run-next` — which is how the first runs should be babysat anyway.
6. **Inbox + evidence card + approve/reject UI.** The review surface, once there is something real to review.

## Open Questions

- Where exactly the Tasks UI lives (left-pane section vs. a tab) — decide during implementation with a mockup.
- Whether per-repo settings should live in `repos.json` or a dedicated overdrive config file.
- Whether the evidence card should retain full command output on disk (vs. excerpt only) for post-hoc debugging.
