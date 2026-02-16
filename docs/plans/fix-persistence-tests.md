# Plan: Fix Persistence Tests After Backend Migration

## Important: Shell Commands

Do NOT wrap shell commands in `zsh -l -c "..."`. All agents already run in a `zsh -l -c` context, so wrapping commands again is redundant and can cause issues. Just run commands directly:

```bash
# WRONG - do not do this
zsh -l -c "pnpm test -- src/renderer/stores/__tests__/ConfigStore.test.ts --run"

# CORRECT - run commands directly
pnpm test -- src/renderer/stores/__tests__/ConfigStore.test.ts --run
```

## Context

The persistence logic was moved from TypeScript (using `@tauri-apps/plugin-fs`) to Rust backend commands. The stores now use `backend.invoke()` instead of direct FS plugin calls. The tests need to be updated to mock `invoke` from `@tauri-apps/api/core` instead of mocking FS plugin functions.

## Pattern to Follow

See `src/renderer/stores/__tests__/ConfigStore.test.ts` for the completed example of how to migrate tests.

### Key Changes

1. **Import `invoke` instead of FS functions:**
   ```typescript
   // OLD
   import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs"

   // NEW
   import { invoke } from "@tauri-apps/api/core"
   ```

2. **Mock `invoke` to handle different commands:**
   ```typescript
   vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
     if (cmd === "load_json_config") return Promise.resolve({ /* data */ })
     if (cmd === "save_json_config") return Promise.resolve(undefined)
     if (cmd === "config_file_exists") return Promise.resolve(true)
     // Add other commands as needed
     return Promise.resolve(undefined)
   })
   ```

3. **Update assertions to check `invoke` calls:**
   ```typescript
   // OLD
   expect(writeTextFile).toHaveBeenCalled()

   // NEW
   expect(invoke).toHaveBeenCalledWith("save_json_config", expect.anything())
   ```

## Test Files to Fix

### 1. `WorkspaceHistoryStore.test.ts`

**Commands used by WorkspaceHistoryStore:**
- `load_json_config` with `filename: "history.json"` - returns `{ history: string[], historyIndex: number } | null`
- `save_json_config` with `filename: "history.json"` - returns `undefined`

**Changes needed:**
- Remove imports of `exists`, `readTextFile`, `writeTextFile`, `mkdir` from `@tauri-apps/plugin-fs`
- Add import of `invoke` from `@tauri-apps/api/core`
- Update `beforeEach` to mock `invoke` with appropriate handlers
- Update all assertions that check FS functions to check `invoke` instead

### 2. `WorkspaceStore.test.ts`

**Commands used by WorkspaceStore:**
- `get_config_dir` - returns config directory path string
- `ensure_chat_dir` - creates chat directory, returns `undefined`
- `load_workspace_state` - returns `{ activeChatId: string | null }`
- `load_chat_index` - returns `{ chats: ChatIndexEntry[] }`
- `list_chat_ids` - returns `string[]`
- `save_workspace_state` - returns `undefined`
- `save_chat_index` - returns `undefined`
- `delete_chat` - returns `undefined`
- `archive_chat_dir` - returns `undefined`

**Changes needed:**
- Remove FS plugin imports
- Add `invoke` import
- Mock `invoke` to handle all the above commands
- The `deleteChat` test specifically checks that the chat file is deleted - update to check `invoke("delete_chat", ...)` was called

### 3. `ChatStore.test.ts` (save timing tests only)

**Commands used by ChatStore:**
- `save_chat` - returns `undefined`
- `load_chat` - returns `ChatFile` or throws if not found

**Changes needed:**
- The "save timing" tests check that `writeTextFile` is called - update to check `invoke("save_chat", ...)` instead
- Mock context needs `getWorkspaceName: () => string` in addition to existing methods

### 4. `ProjectRegistry.test.ts`

**Commands used by ProjectRegistry:**
- `load_project_registry` - returns `{ projects: Project[] }`
- `save_project_registry` - returns `undefined`

**Changes needed:**
- Remove FS plugin imports
- Add `invoke` import
- In `beforeEach`, mock `invoke` to return empty projects by default
- Update all assertions that check FS functions to check `invoke` instead
- Tests that check file content need to capture the `registry` argument from `save_project_registry` calls

### 5. `ToolAvailabilityStore.test.ts`

This test file uses `invoke` directly for `check_command_exists` but the global mock in `src/test/setup.ts` returns `undefined` by default. The tests need to properly mock the response.

**Fix:** Update tests to mock `invoke` to return `{ available: true, version: "1.0" }` or `{ available: false }` as appropriate.

### 6. `claude.test.ts` and `copilot.test.ts`

These tests mock `invoke` for agent commands but may be affected by the global mock setup. Check if they need updates.

## Execution Order

1. Fix `WorkspaceHistoryStore.test.ts` first (simplest - only uses `load_json_config` / `save_json_config`)
2. Fix `ChatStore.test.ts` save timing tests
3. Fix `WorkspaceStore.test.ts`
4. Fix `ProjectRegistry.test.ts`
5. Fix `ToolAvailabilityStore.test.ts`
6. Verify `claude.test.ts` and `copilot.test.ts`

## Verification

After each file is fixed, run:
```bash
pnpm test -- <test-file-path> --run
```

When all are fixed, run full test suite:
```bash
pnpm test
```

All 815 tests should pass.
