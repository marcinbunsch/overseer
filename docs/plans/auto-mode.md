# Auto Mode

Auto mode lets Overseer pick up work on its own: the user maintains a local task ledger, a scheduler pops tasks off the queue (e.g. overnight), each task runs as an autonomous session in a fresh workspace, and every run must prove itself with a **machine-verified harness** before landing in a review inbox. Nothing merges — and nothing even leaves the machine — without human approval.

Status: **design approved, not yet implemented**.

## Vision

> I write down tasks during the day. Overnight, Overseer works through them one at a time — each in its own workspace, each verified by tests it had to write first — and in the morning I have an inbox of reviewed-and-green branches with evidence attached.

Auto mode is one step beyond [Autonomous Mode](../features/autonomous-mode.md): autonomous mode loops on a task the user *starts*; auto mode also decides *when to start* and *what to work on*, and adds a verification contract.

## Design Decisions (locked)

These were decided explicitly during design; changing them needs a deliberate revisit.

1. **Local ledger is the source of truth.** Tasks live in a local, user-editable queue with its own UI. No tracker integration in the critical path. Notion/Linear become a *sync layer* later (an agent that imports tickets into the ledger); the ledger remains authoritative.
2. **Interval scheduler from day one** (plus a manual "run next task" trigger). Rust-side timer, not JS — macOS App Nap throttles background webview timers.
3. **Runs stop at a local branch.** The worker commits locally and writes a summary. No push, no PR, no ticket comments. Nothing leaves the machine until the user approves.
4. **One run in flight, globally.** Simple state machine, easy to babysit, cheap on tokens.
5. **Backpressure, configurable.** If more than N runs (default 3) sit in `needs-review`, the scheduler pauses picking new work.
6. **Workers run in YOLO mode.** Required for unattended operation; same forced-YOLO mechanism autonomous mode already uses (`getYoloModeValueForAgent()`). The safety boundary is the disposable workspace + the human gate at merge, not permission prompts.
7. **Per-repo auto prompt.** A repo-settings field ("auto agent instructions") injected into every worker run — this is where the user bounds how wild the agent can go (dependencies, migrations, style, risk appetite).
8. **Verification is observed, not claimed.** The proof of success is an exit code from a process *Overseer* spawned — never prose in the agent's summary. See "Verification Harness" below; this is the core of the feature.

## Relationship to Autonomous Mode

Auto mode **wraps** autonomous mode; it does not replace it.

| Concern | Owner |
|---|---|
| Fresh-context impl → review iteration loop | Existing `ChatStore.startAutonomousRun()` |
| YOLO permission forcing per agent type | Existing `getYoloModeValueForAgent()` |
| Completion signal (`AUTONOMOUS_SESSION_COMPLETE`, review-only) | Existing |
| Progress files (`autonomous-prompt.md`, `autonomous-progress.md`, `autonomous-review.md`) | Existing |
| Task queue, scheduling, workspace provisioning | **New** (`AutoModeStore` + Rust scheduler) |
| Harness lifecycle (register → red check → green check) | **New** |
| Run records, inbox, evidence card | **New** |

Note on scope today: autonomous mode's *toggle* is global (`ConfigStore.autonomousModeEnabled`) and its *run state* is per-chat (`ChatStore`). Auto mode adds the missing layer: per-repo configuration and a global scheduler.

The worker prompt templates need one extension over stock autonomous mode: the harness phase (see below) and the harness-integrity mandate in the review step.

## Data Models

```typescript
type TaskStatus = "todo" | "running" | "needs-review" | "done" | "failed" | "rejected"

interface AutoTask {
  id: string
  repoId: string
  title: string
  description: string
  /** Optional user-authored verification criteria. When present, the harness
      phase MUST honor it. When absent, the agent proposes the harness. */
  verification?: string
  /** Refactor-type tasks where the harness is expected to be green from the
      start (criteria = suite stays green + review passes). Skips the red check. */
  expectGreenHarness?: boolean
  status: TaskStatus
  /** Queue position; top of the list runs first. */
  order: number
  createdAt: Date
  runIds: string[]
  /** Future sync layer: e.g. linear:OVR-123, notion:<page-id>. Unused in v1. */
  sourceRef?: string
}

type AutoRunStatus =
  | "provisioning"   // creating workspace + chat
  | "harness"        // building + registering verification
  | "red-check"      // Overseer running harness, expecting failure
  | "working"        // autonomous impl→review loop
  | "final-verify"   // Overseer running harness + repo checks, expecting success
  | "needs-review"   // green; waiting for human
  | "needs-input"    // agent asked a question; paused
  | "approved"       // human approved (merge flow)
  | "rejected"       // human rejected (workspace archived)
  | "failed"         // budget exceeded, unrecoverable error, or thrash limit
  | "interrupted"    // app quit mid-run

interface VerificationEvidence {
  commands: string[]
  /** Result of each Overseer-executed check. */
  redCheck?: { exitCodes: number[]; outputExcerpt: string; at: Date }
  finalCheck?: { exitCodes: number[]; outputExcerpt: string; at: Date }
  /** Diff of registered harness files between red check and final check.
      Non-empty = flag for the reviewer/human. */
  harnessDrift?: string
}

interface AutoRun {
  id: string
  taskId: string
  repoId: string
  workspaceId?: string
  chatId?: string
  status: AutoRunStatus
  verification?: VerificationEvidence
  result?: { summary: string; assumptions: string[] }
  /** How many times final-verify bounced back to working. */
  verifyBounces: number
  iterationsUsed: number
  startedAt: Date
  endedAt?: Date
  error?: string
}
```

Persistence:

- Tasks: `~/.config/overseer[-dev]/tasks/{repo}.json`
- Runs: `~/.config/overseer[-dev]/auto-runs.json` (doubles as inbox history)

Both use `getConfigPath()` / `cfg!(debug_assertions)` path conventions.

## Task Ledger UI

A per-repo **Tasks** view (left-pane section under the repo, alongside workspaces):

- Add task: title + description (+ optional verification criteria, + expect-green flag)
- Edit, delete, reorder (drag; `order` field). Queue order = execution order.
- Status chips per task; click a `needs-review`/`running` task to jump to its run's workspace chat.
- Badge count on the repo for `needs-review` + `needs-input`.

This is the "write todos during the day, they run overnight" surface. Keep it fast to add a task — title + description must be enough; verification criteria optional by design.

## Scheduler

- **Rust-side** `tokio` interval emitting an `auto-mode:tick` event to the frontend. Runs only while ≥1 repo has auto mode enabled (started/stopped via Tauri command when the config changes — no idle timer otherwise).
- Frontend `AutoModeStore` handles ticks:
  1. Skip if a run is in flight (one-at-a-time rule).
  2. Skip if `needs-review` count ≥ backpressure cap.
  3. Round-robin enabled repos; pop the top `todo` task; start a run.
- Manual **"Run next task"** button per repo (same code path as a tick, ignores the interval).
- Interval configurable per… global (one scheduler). Default 15 min. The *tick* is global; *eligibility* is per-repo (enable toggle).

Principles note: this bends "no timers" — it is opt-in, off by default, active only when the user has enabled auto mode somewhere, and it is user-scheduled work rather than idle polling.

## Run Lifecycle

```
todo task popped
   ↓
provisioning     create workspace (existing animal-name flow) + chat titled after task
   ↓
harness          iteration 0: agent reads task, builds verification, emits set_verification
   ↓
red-check        OVERSEER runs the registered commands in the workspace
   │               • expected: failure (unless task.expectGreenHarness)
   │               • harness green here → bounce back to harness phase with feedback
   │               • snapshot harness files for drift detection
   ↓
working          existing autonomous impl→review loop (fresh context per iteration,
   │             YOLO, review-only completion) with harness-integrity mandate
   ↓  review signals AUTONOMOUS_SESSION_COMPLETE
final-verify     OVERSEER runs: registered commands + repo check command (e.g. pnpm test)
   │               • any red → bounce back to working (verifyBounces++, capped, e.g. 2)
   │               • compute harnessDrift
   ↓  all green
needs-review     commit ensured; agent emitted report_result; notification fired
   ↓
approved → existing merge dialog        rejected → existing archive-workspace flow
```

Off-ramps at any stage: `failed` (budget/thrash/error), `needs-input` (agent asked a question — existing question UI renders it, run pauses, notification fired), `interrupted` (app quit; on next launch the run is marked interrupted; the chat is persisted, so the user can resume manually).

Budgets: max iterations (reuse autonomous max, per-repo default), wall-clock cap per run (default 30 min), verify-bounce cap (default 2).

## Verification Harness

**Core rule: the agent never gets to declare success. Overseer observes it.**

Agents under a "finish the task" objective will hallucinate "all tests pass ✓". They cannot hallucinate an exit code from a process the app spawned. Therefore:

1. **Harness first.** Before any implementation, the worker must decide how success is machine-checkable for *this* task — unit test, functional test, script, whatever fits — build it, and register it:

   ```overseer
   {"action": "set_verification", "params": {"commands": ["pnpm test src/foo/__tests__/bar.test.ts", "pnpm checks:ui"]}}
   ```

   If the task has user-authored `verification` criteria, the harness must honor them. If not, the agent proposes the harness and records its reasoning in `autonomous-progress.md` so the choice is auditable.

2. **Red check.** Overseer runs the registered commands itself. For feature/bugfix tasks the harness **must fail** at this point — a harness that is green before the work exists proves nothing. (`expectGreenHarness` tasks skip this: refactors where the criteria is "suite stays green".) Overseer snapshots the harness files.

3. **Harness integrity.** The autonomous review step gets an added mandate: check the diff for gamed verification — deleted/weakened assertions, `expect(true)`, skipped tests, harness edits. Independently, Overseer diffs the registered harness files against the red-check snapshot and surfaces any `harnessDrift` on the evidence card. Drift is not automatically fatal (tests legitimately evolve) but it is always visible to the human.

4. **Final verify by Overseer.** On completion signal, Overseer re-runs the registered commands **plus** the repo's standard check command (per-repo setting, e.g. `pnpm test`) to catch regressions outside the harness. Exit codes + output excerpts are stored on the run. Red → bounce back to the loop (capped); green → `needs-review`.

5. **Evidence card.** The inbox entry for a run shows observed facts: harness commands, red-at-start ✓, green-at-end ✓ (with output), full-suite result, diffstat, harness drift, iterations used, duration — plus the agent's `report_result` summary and assumptions.

Harness vocabulary in v1 is **anything runnable as a shell command in the workspace**. GUI/e2e testing of Tauri apps (WebDriver etc.) is explicitly out of scope — its own future project.

Command execution: reuse the existing process-spawn machinery (login shell, workspace cwd), capture exit code + tail of output. Commands run with a timeout (default 10 min per command).

## New Overseer Actions

Extends the [Overseer Actions protocol](../features/overseer-actions.md). Injected into worker prompts only (not general chats).

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

- **Auto section** at the top of the left pane: cross-repo run list (task title, repo, status dot, diffstat, duration). Badge on `needs-review` / `needs-input` / `failed`. Click → navigates to the run's workspace + chat via existing selection.
- **Auto-created workspaces** get a robot badge in the repo tree.
- **Chat header status strip** on auto-run chats: task title, run status, evidence summary (red→green ✓), and **Approve** / **Reject** buttons.
  - Approve → existing merge dialog.
  - Reject → existing archive-workspace confirm.
  - Request changes → just type in the chat; it is a live chat. Zero new machinery.
- **Notifications**: toast + native notification on `needs-review`, `needs-input`, `failed`.

## Settings

Per-repo (repo settings dialog, next to init prompt / PR prompt):

- Auto mode enabled (default off)
- Auto agent instructions (the "how wild" prompt)
- Check command for final verify (default: repo's test command, e.g. `pnpm test`)
- Max iterations per run, wall-clock budget

Global (Settings):

- Scheduler interval (default 15 min)
- Backpressure cap (default 3 unreviewed runs)
- Agent + model for auto runs (default: default agent)

## Failure Modes & Edge Cases

- **Agent never emits `set_verification`** → after the harness-phase iteration budget (e.g. 2 iterations), run fails with "no verification registered". No harness, no run — this is the contract.
- **Harness green at red check** → one bounce back with feedback ("your harness passes before any work; make it actually test the change"); second time, fail.
- **Final verify keeps failing** → `verifyBounces` cap (2), then `failed`. Workspace kept for autopsy.
- **Agent asks a question** → existing question UI renders it; run → `needs-input`; scheduler keeps skipping (a needs-input run counts as in-flight until answered or stopped).
- **App quits mid-run** → run marked `interrupted` on next launch; chat persisted; user resumes manually if desired. No auto-resume in v1.
- **Dirty main checkout** → irrelevant; runs happen in fresh workspaces off the base branch.
- **Task edited while running** → edits apply to future runs; the in-flight run keeps its snapshot (the prompt was already written to `autonomous-prompt.md`).

## Out of Scope for v1

- Notion/Linear/tracker sync (future: an import agent writing into the ledger; `sourceRef` field is reserved for it)
- GUI/e2e harnesses for Tauri apps
- Auto-push / auto-PR / auto-merge (runs stop at a local branch by decision #3)
- Concurrency > 1
- Auto-resume of interrupted runs
- Retry policies beyond the bounce caps

## Implementation Surface (estimate)

New: `AutoModeStore`, task ledger persistence + UI, Rust scheduler command + tick event, run records + inbox UI, chat-header status strip, harness runner (spawn command, capture exit code — likely a thin Tauri command), two overseer actions, worker prompt templates (harness phase + integrity mandate), repo/global settings fields.

Reused: workspace provisioning, `startAutonomousRun()` loop, YOLO forcing, question UI, merge dialog, archive flow, notifications, chat persistence, diff/changes review.

## Open Questions

- Where exactly the Tasks UI lives (left-pane section vs. a tab) — decide during implementation with a mockup.
- Whether the scheduler should have quiet hours ("only run between 22:00–07:00") — cheap to add, deferred until wanted.
- Whether `needs-input` should time out back to `failed` after some hours so an overnight queue doesn't stall on one question.
