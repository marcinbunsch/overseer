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
