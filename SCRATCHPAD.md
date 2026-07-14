# Scratchpad

My learning journal for this codebase. **Rules** are patterns I must follow. **Mistakes Log** tracks past errors for context.

---

## Rules

### Testing

- **Always use test IDs for element selection** — Never query by text content. Text can appear in multiple places (labels, instructions, content). Use `data-testid` attributes and `getByTestId`/`queryByTestId`.
- **Mock complex rendering libraries** — For react-markdown, react-syntax-highlighter, use simple mocks that provide predictable structure:
  ```typescript
  vi.mock("react-markdown", () => ({
    default: ({ children }: { children: string }) => (
      <div data-testid="markdown-content">{children}</div>
    ),
  }))
  ```

### MobX

- **Use decorators, not makeAutoObservable** — Always use `@observable`, `@computed`, `@action` on separate lines. Makes reactive structure explicit.
- **Always call makeObservable(this)** — Required in constructor when using decorators. Don't forget this!
- **Store event unsubscribe functions** — Event subscriptions return unsubscribe callbacks. Store them in the instance.
- **Add dispose() methods** — Stores need cleanup: unsubscribe from events, clear timeouts, null out stored functions.
- **Store view state in stores, not components** — For things like `viewMode`, `highlightedLine`, put them in MobX stores so they persist across re-renders and are accessible from multiple components.

### UI Patterns

- **Two-phase highlighting** — For navigation vs editing: use `highlightedLine` for visual-only highlight, separate `pending` state for editor. Clear highlight when user starts interacting.
- **View mode toggles** — Store mode in MobX, add action like `switchToCodeAtLine(index)` for cross-view navigation.

### Tauri

- **Always make Tauri commands async** — Synchronous `#[tauri::command]` functions block the main thread during the entire IPC roundtrip, causing UI lag. Always use `async fn` for Tauri commands, even if the operation itself is fast. This moves execution to Tauri's async runtime.
- **Check capabilities for FS operations** — Tauri fails silently if permissions aren't granted. Check `src-tauri/capabilities/default.json`. Common permissions: `fs:allow-rename`, `fs:allow-remove`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-mkdir`, `fs:allow-exists`.

### React

- **Sync refs with async state** — When refs track values loaded asynchronously (from disk/API), sync the ref at operation start, not just at mount.
- **Async service init pattern** — When a service method becomes async (like `getOrCreate`), update components to use `useEffect` with `mounted` flag pattern to handle cleanup properly.

### Architecture

- **Keep invoke() in services** — Low-level Tauri `invoke()` calls should stay in the service layer, not leak into stores. Expose clean methods like `terminalService.write()` instead of having stores call `invoke("pty_write", ...)`.
- **Credentials never in memory** — When dealing with tokens/secrets, use shell subprocesses with pipes. Never store credentials in variables, even temporarily. Let the shell handle the token flow.
- **Don't overthink working solutions** — If user provides a working shell command, use it exactly. Don't try to "improve" by removing dependencies or using alternatives.
- **Platform-specific features** — Use `#[cfg(target_os = "macos")]` in Rust. Frontend should detect unsupported platforms once and gracefully disable the feature (use `isSupported` flag pattern).

### Rust

- **Small bites with context** — When writing Rust code, make changes incrementally with explanations. The user is learning Rust, so explain concepts, idioms, and the "why" behind patterns as you go.

### Code Style

- **Never use nested ternaries** — Extract logic into utility functions or use switch statements. Nested ternaries are unreadable. Example: `getAgentDisplayName(agentType)` instead of `agentType === "codex" ? "Codex" : agentType === "copilot" ? "Copilot" : ...`
- **Explicit over implicit** — Use explicit metadata/flags rather than content-based heuristics. For example, mark system messages with `meta.type = "system"` rather than detecting them by checking if content ends with another message's text. Explicit markers are maintainable and debuggable; implicit detection is brittle and breaks unexpectedly.

### Design System

Use shared components from `src/renderer/components/shared/` for consistent styling:

- **Input** — `<Input>` for text inputs. Autocomplete disabled by default. Uses `ovr-input` class.
- **Textarea** — `<Textarea>` for multiline text. Autocomplete disabled by default. Uses `ovr-textarea` class. Add `resize-none` for non-resizable, `resize-y` for vertically resizable.
- **Checkbox** — `<Checkbox>` for checkboxes. Uses `ovr-checkbox` class.
- **Buttons** — Use utility classes directly:
  - `ovr-btn-primary` — Primary action (azure blue, glowing)
  - `ovr-btn-ghost` — Secondary action (subtle, bordered)
  - `ovr-btn-danger` — Destructive action (red)
- **Select** — Use Radix UI `Select.*` components with these classes:
  - Trigger: `rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2 text-xs`
  - Content: `rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg`
  - Item: `rounded px-2 py-1.5 text-xs data-[highlighted]:bg-ovr-bg-panel`

To preview all design system elements, enable dev mode and go to Settings → Design System tab.

---

## Project Knowledge

- **Dev vs Prod paths**: Dev mode uses different paths to avoid conflicts with stable builds:
  - Dev: `~/.config/overseer-dev/` and `~/overseer/workspaces-dev/`
  - Prod: `~/.config/overseer/` and `~/overseer/workspaces/`
  - Use `getConfigPath()` from `utils/paths.ts` for TypeScript, `cfg!(debug_assertions)` for Rust
- Animal-named workspace folders: `~/overseer/workspaces[-dev]/{repo}/`
- Chat folders: `~/.config/overseer[-dev]/chats/{repo}/{animal}/`
- Archived chats: `~/.config/overseer[-dev]/chats/{repo}.archived/`
- Settings load async from `~/.config/overseer[-dev]/` — don't assume ready at mount

### Overdrive (headless run engine)

- **Driving a session from core, no frontend** — `overdrive::run_turn` (`crates/overseer-core/src/overdrive/`) proves Phase 1: `chat_sessions.register_session(...)` → subscribe to the event bus → `claude_agents.send_message(config, event_bus, approval_manager, chat_sessions)` → await completion by reading the bus. No WebSocket/IPC/frontend needed; the managers already emit everything. Trigger it manually with `cargo run -p overseer-core --example overdrive_spike -- --workspace <dir> --prompt "..."`.
- **Turn completion = event-bus observation, not process exit** — a turn is done when `AgentEvent::TurnComplete` (or `Done`, or `agent:close:{conv}`) lands on the bus. Claude emits `TurnComplete` on the stream-json `"result"` message; Pi emits `TurnComplete`+`Done` on `agent_end`. Isolate the "await completion" loop from the spawn side so it's unit-testable by emitting hand-built `BroadcastEvent`s onto a real `EventBus` (no CLI needed) — see `overdrive::iterator::await_turn_completion`.
- **`agent:event:{conv}` payload is a flattened `SeqEvent`** — `SeqEvent` uses `#[serde(flatten)]` on its `event`, so the wire payload is `{"seq":N, "kind":"text", ...}`. It deserializes **directly as `AgentEvent`** (the extra `seq` is ignored by the internally-tagged enum). The persistence-failure fallback emits a bare `AgentEvent` — same deserialize path works for both.
- **YOLO mapping belongs in core now** — unattended Claude runs force `permission_mode = "bypassPermissions"` (mirrors the frontend's `getYoloModeValueForAgent`). Safety boundary = disposable workspace + human review gate, not permission prompts.
- **Run state machine (`overdrive/engine.rs` + `run.rs`)** — `execute_run` drives provisioning → harness (agent emits `set_verification`) → red-check (`run_check`, expect fail) → working (impl→review loop) → final-verify → needs-review, persisting `OverdriveRun` to `overdrive-runs.json` and emitting `overdrive:run-status` each transition. Keep the *decisions* pure and unit-tested (`decide_after_red_check`, `decide_after_final_verify`, `harness_from_actions`) and leave only side effects in `execute_run` (same split as Phase 1's `await_turn_completion`). The full loop is proven via `examples/overdrive_run.rs`, not CI.
- **Fresh context per iteration = `stop` + `session_id: None`** — one chat_id per run (all iterations persist under it), but before each iteration call `claude_agents.stop(chat_id)` and pass `session_id: None` so a brand-new process spawns with no `--resume`. State carries only through the `overdrive-*.md` memory files, exactly like frontend autonomous mode clearing `agentSessionId`.
- **A mid-run `Question` must become `NeedsInput`, not a hang** — YOLO suppresses `ToolApproval` but not `ask_user_question`; the agent blocks on stdin and `TurnComplete` never fires. `collect_turn` returns `TurnOutcome::NeedsInput` on `AgentEvent::Question` so the run pauses instead of timing out.
- **Scheduler + run-next (`overdrive/manager.rs`)** — `OverdriveManager` holds only a single-flight guard (`Mutex<Option<task_id>>`) + `Arc<OverseerContext>`; it is NOT on `OverseerContext` (avoids an Arc cycle) — it lives in `HttpSharedState` and Tauri managed state, both built from the context. `run_next` reserves the slot, spawns `execute_run`, maps the finished run's status back onto the task. `run_scheduler` is a fixed 60s tokio interval whose `tick` re-reads config and no-ops while `schedulerEnabled` is false (off by default) — so it's always spawned but cheap. Keep the tick decision pure (`scheduler_should_run`: in-flight / backpressure / run-window) and unit-test it.
- **Per-run logs (`overdrive/log.rs`)** — `RunLogger` reuses `logging::{open_log_file,log_line}` to write `{config_dir}/logs/overdrive/{repo}/{ts}-{shortid}.log` (ts = `%Y%m%dT%H%M%SZ`, sortable). The engine logs its own view (transitions, harness cmds + exit codes, decisions) — complementary to the agent chat JSONL. Guard the repo name as a single path component.
- **Same command shape across backends** — a command returning `Option<String>` must return the SAME JSON both ways: the Tauri command returns `Option<String>` directly (→ `string|null`), so the HTTP dispatcher must `ovr_ok(Some(json!(option)))` (bare `string|null`), NOT `{startedTaskId: ...}`. `backend.invoke` unwraps HTTP `data` and Tauri return value, so mismatched shapes silently diverge between web and desktop.

### Frontend testing pitfall

- **`vi.mock` factories are hoisted — only `mock`-prefixed names are safe to reference inside them** — `vi.mock("../x", () => ({ ... }))` is hoisted above `const` declarations, so referencing a non-hoisted outer const (e.g. `fakeBackend`) throws "Cannot access before initialization". Vitest special-cases identifiers starting with `mock` (e.g. `mockInvoke`, `mockListen`). Inline the object literal in the factory and only reference `mock*` vars.

### Rust testing pitfall

- **NEVER `std::env::set_var("HOME", ...)` in a `#[test]`** — cargo runs tests as parallel threads in ONE process, so mutating a global env var races every other test that reads it (setting HOME broke `git::worktree::pick_workspace_dir_*` intermittently). Make the logic pure (take `home: &str` as a param) and test that; keep the env read in a thin non-tested wrapper.

### Pi agent

- **Session resume via `--session-id`** — Pi's `--session-id <id>` flag *creates the session if missing, resumes if it exists*. Overseer generates a UUID on the first message (`pi.ts`), emits a `sessionId` event to persist it to chat metadata, and passes it to `--session-id` on every spawn so a restarted RPC process resumes context. Threaded through `start_pi_server(session_id)` → `PiStartConfig.session_id` → `PiConfig.session_id`.
- **Pi RPC `-p` exits on stdin EOF** — When smoke-testing `pi --mode rpc -p`, piping a single line closes stdin and Pi exits *before* the model responds (only the user message echoes back). Overseer's real flow keeps the process alive, so to reproduce locally hold stdin open (e.g. `{ echo '...'; sleep 25; } | pi --mode rpc`).
- **First-message detection** — Key "is this the first prompt" off `!chat.sessionId`, NOT the per-turn `running` flag (which resets after every turn, so it's `false` at the start of every message and wrongly re-prepends initPrompt).
- **Pi `*_end` bookends arrive OUT OF ORDER** — In `message_update`, Pi streams `thinking_delta`s then `text_delta`s, but the `thinking_end`/`text_end` bookends (which carry the *full* content) are emitted at the very end of the turn — `thinking_end` fires *after* the answer's `text_delta`s. So NEVER buffer thinking and flush on `thinking_end` (renders after the response → looks swapped). Stream `thinking_delta` → `AgentEvent::Thinking` live and ignore both `_end` bookends. Verified against pi 0.80.3 by capturing `{ echo '{"type":"prompt",...}'; sleep 50; } | pi --mode rpc -p`.
- **Interactive prompts use the extension-UI sub-protocol, not AgentEvents** — Tools like `ask_user_question` (a user extension calling `ctx.ui.select`) emit a top-level `{"type":"extension_ui_request","method":"select",...}` line on stdout and BLOCK until the client writes `{"type":"extension_ui_response","id":...,"value":...}` on stdin. The parser turns `method:"select"` into `AgentEvent::Question` (reusing the option-picker UI); `PiAgentService.sendToolApproval` echoes the answer back via `pi_stdin`. Only `select` is wired up. Full protocol + shapes in [docs/pi/prompts.md](docs/pi/prompts.md).
- **`turn_end` is per-round-trip, NOT completion** — Pi's agent loop (`packages/agent/src/agent-loop.ts`) emits `turn_end` after *every* LLM turn, i.e. once after each tool cycle → multiple per prompt. `agent_end` fires exactly once when the whole run is done. Pi's own TUI gates idle/busy on `agent_end` and ignores `turn_end`. So map Pi `agent_end` → `[TurnComplete, Done]` and `turn_end` → nothing. Mapping `turn_end` → `TurnComplete` fires Overseer's full completion handler (notifications, queued follow-ups, file refresh, autonomous progression) mid-run.
- **Thinking rendering path** — Pi thinking flows as `AgentEvent::Thinking` → frontend `{kind:"thinking"}` → ChatStore accumulates into one `isThinking` message (like `bashOutput`) → `ThinkingItem` collapsible block in `MessageItem`. `groupMessagesIntoTurns.finalizeTurn` must skip `isThinking` messages or a trailing thinking block gets promoted to `resultMessage`.

---

## Mistakes Log

### 2026-02-07: Tauri FS permissions

**Issue**: Chat archiving wasn't working - `rename()` calls were silently failing.
**Cause**: Missing `fs:allow-rename` permission in capabilities file.

### 2026-02-07: React refs vs async state

**Issue**: Panel drag handles jumping ~100px on first drag.
**Cause**: Refs initialized at mount with defaults, but actual values loaded async. First drag used stale ref.

### 2026-02-07: Makefile variable escaping

**Issue**: `$(pgrep ...)` interpreted as Make variable.
**Fix**: Use `$$()` for shell command substitution in Makefiles.

### 2026-02-07: Test regex too broad

**Issue**: `queryByText(/comment/i)` matched instruction text containing "comments".
**Fix**: Use specific patterns like `/^\d+ comments?$/` for badge text.

### 2026-02-07: MobX singleton store state leaking between tests

**Issue**: Tests using singleton MobX stores (like `toolAvailabilityStore`) were sharing state, causing flaky tests.
**Fix**: Two approaches:

1. Reset store state explicitly in `beforeEach`: `toolAvailabilityStore.claude = null`
2. For tests that need fresh module instances, use `vi.resetModules()` before dynamic imports:
   ```typescript
   vi.resetModules()
   const { claudeAgentService } = await import("../claude")
   const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")
   ```

### 2026-02-07: TypeScript optional chaining after assertion

**Issue**: `expect(store.value).not.toBeNull()` followed by `store.value?.prop` causes TypeScript error because optional chaining implies the value could still be null.
**Fix**: After a runtime assertion like `not.toBeNull()`, use non-null assertion: `store.value!.prop`

### 2026-02-11: Synchronous Tauri commands cause UI lag

**Issue**: "Open in terminal" button felt slow/laggy.
**Cause**: `open_external` was a synchronous Tauri command (`fn` instead of `async fn`). Even though `spawn()` returns quickly, the synchronous command blocks the main thread during the entire JS→Rust→JS IPC roundtrip.
**Fix**: Add `async` to all Tauri command functions. This moves them off the main thread to Tauri's async runtime.

### 2026-02-16: Process recv() vs try_recv() deadlock

**Issue**: Codex agent caused app to beachball (freeze) when sending a message.
**Cause**: The event forwarding thread used `process.recv()` (blocking) while holding a mutex lock on the process. When TypeScript tried to send stdin via `codex_stdin`, it couldn't acquire the lock because the event thread was blocked waiting for data while holding it.
**Fix**: Use `process.try_recv()` (non-blocking) instead, with a small sleep (10ms) when no data is available. This pattern releases the mutex between checks, allowing stdin writes to proceed. See `src-tauri/src/agents/claude.rs` for the correct pattern.

### 2026-02-17: Claude Usage Indicators - Security & Lifecycle

**Issue**: Adding usage limit indicators for Claude API.
**Mistakes**:
1. Initially tried to extract OAuth token into Overseer memory and use reqwest
2. Overthought the shell command, tried to replace jq with Python
3. Used `jq` in final solution - not available on fresh macOS installations
4. Forgot `makeObservable(this)` in MobX store constructor
5. Didn't store event bus unsubscribe function
6. Didn't add `dispose()` method for cleanup

**Correct approach**:
- Run entire curl pipeline in shell subprocess with token extraction
- Token never enters Overseer memory - stays in shell pipes
- Use standard Unix tools only (`grep`, `sed`) - available on every Mac
- Parse token: `security ... | grep -o '"accessToken":"[^"]*"' | sed 's/"accessToken":"//;s/"$//'`
- Always add `makeObservable(this)` when using MobX decorators
- Store unsubscribe functions from event subscriptions
- Add `dispose()` method to clean up resources (events + timeouts)
- Write comprehensive tests before claiming feature is complete

**Key insight**: Security architecture trumps convenience. When dealing with credentials, use shell subprocesses even if it seems less "clean" than using a library. Only use tools guaranteed to exist on target platform.
