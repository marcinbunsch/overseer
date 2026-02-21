# Backend (src-tauri) Test Coverage Report

**Generated:** 2026-02-21
**Overall Coverage:** 0.16% — Only 12 test functions across 7,613 lines of code

## Summary

The Rust backend has **minimal test coverage**. The codebase follows a "thin wrapper" pattern where most business logic resides in `overseer-core`, but critical Tauri integration points remain largely untested.

| Module | LOC | Tests | Coverage | Priority |
|--------|-----|-------|----------|----------|
| lib.rs | 576 | 3 | 0.5% | Tier 2 |
| git.rs | 237 | 1 | 0.4% | Tier 4 |
| approvals.rs | 63 | 0 | 0% | Tier 3 |
| chat_session.rs | 138 | 0 | 0% | **Tier 1** |
| persistence.rs | 372 | 0 | 0% | **Tier 1** |
| pty.rs | 62 | 0 | 0% | Tier 2 |
| agents/claude.rs | 75 | 0 | 0% | **Tier 1** |
| agents/codex.rs | 58 | 0 | 0% | **Tier 1** |
| agents/copilot.rs | 58 | 0 | 0% | **Tier 1** |
| agents/gemini.rs | 64 | 0 | 0% | **Tier 1** |
| agents/opencode.rs | 112 | 0 | 0% | **Tier 1** |
| http_server/mod.rs | 290 | 2 | 0.7% | Tier 2 |
| http_server/auth.rs | 162 | 6 | 3.7% | ✓ Good |
| http_server/routes.rs | 3,776 | 0 | 0% | **Tier 1** |
| http_server/websocket.rs | 376 | 0 | 0% | Tier 2 |
| http_server/state.rs | 175 | 0 | 0% | Tier 3 |
| **TOTAL** | **7,613** | **12** | **0.16%** | |

---

## 🔴 Tier 1 - Critical (Core Functionality)

### persistence.rs (372 LOC, 0 tests)
**Core data layer — failures affect all users**

Functions (20+):
- Chat file operations (save, load, delete)
- Chat index management
- Project registry CRUD
- Workspace state management
- JSON config file operations
- Archive operations

Missing tests:
- [ ] Chat save/load/delete cycles
- [ ] Chat index operations
- [ ] Project registry CRUD operations
- [ ] Workspace state persistence
- [ ] JSON config serialization/deserialization
- [ ] Archive/unarchive operations
- [ ] Error handling (permission errors, disk full)

### http_server/routes.rs (3,776 LOC, 0 tests)
**Largest module — all HTTP API endpoints**

Functions (70+):
- Git operations (12 handlers)
- Persistence operations (15 handlers)
- Approvals (4 handlers)
- Chat sessions (2 handlers)
- Agent operations (15 handlers)
- PTY operations (4 handlers)

Missing tests:
- [ ] Route parameter parsing
- [ ] JSON serialization/deserialization
- [ ] Error handling for each command
- [ ] HTTP status codes
- [ ] Integration tests for API workflows

### chat_session.rs (138 LOC, 0 tests)
**Complex seq number handling for deduplication**

Functions (9):
- Session registration/unregistration
- Event appending and loading (with seq numbers)
- Chat metadata operations
- User message persistence

Missing tests:
- [ ] Session registration/unregistration flows
- [ ] Event loading with sequence numbers
- [ ] Metadata save/load operations
- [ ] User message creation
- [ ] Offset-based vs seq-based loading

### Agent Modules (5 files, 379 LOC combined, 0 tests)

| File | LOC | Functions |
|------|-----|-----------|
| agents/claude.rs | 75 | start, stop, stdin, list |
| agents/codex.rs | 58 | start, stop, stdin, list |
| agents/copilot.rs | 58 | start, stop, stdin, list |
| agents/gemini.rs | 64 | start, stop, stdin, list |
| agents/opencode.rs | 112 | start, stop, message, list, models |

Missing tests for each agent:
- [ ] Process startup with various configurations
- [ ] Message sending/receiving
- [ ] Stop/cleanup operations
- [ ] Error handling (agent not found, startup failure)
- [ ] Protocol-specific behavior

---

## 🟠 Tier 2 - High Priority

### http_server/websocket.rs (376 LOC, 0 tests)
**Real-time event streaming**

Functions:
- Pattern-based event filtering
- Subscription/unsubscription handling
- Event broadcasting

Missing tests:
- [ ] Connection lifecycle
- [ ] Subscription pattern matching
- [ ] Event filtering and routing
- [ ] Client disconnection handling
- [ ] Concurrent subscribers

### pty.rs (62 LOC, 0 tests)
**Terminal integration**

Functions (4):
- `pty_spawn()` - Create new PTY
- `pty_write()` - Write to terminal
- `pty_resize()` - Resize terminal
- `pty_kill()` - Terminate PTY

Missing tests:
- [ ] PTY spawning with various configurations
- [ ] Data writing to PTY
- [ ] Resize operations
- [ ] Graceful shutdown/kill

### lib.rs (576 LOC, 3 tests)
**Main library — needs more coverage**

Existing tests:
- ✓ `pr_status_serializes()`
- ✓ `check_command_exists_finds_git()`
- ✓ `check_command_result_serializes()`

Missing tests:
- [ ] `generate_auth_token()` - Token generation
- [ ] `extract_overseer_blocks_cmd()` - Block extraction
- [ ] `open_external()` - External command execution
- [ ] `start_http_server()` - Server initialization
- [ ] Menu event handling

---

## 🟡 Tier 3 - Medium Priority

### approvals.rs (63 LOC, 0 tests)
Functions (4):
- `load_project_approvals()`
- `add_approval()`
- `remove_approval()`
- `clear_project_approvals()`

### http_server/state.rs (175 LOC, 0 tests)
Functions:
- Token validation
- Context access
- State creation

---

## 🟢 Tier 4 - Lower Priority

### git.rs (237 LOC, 1 test)
Note: File comments state "Most git tests are now in overseer-core"

Only serialization test exists:
- ✓ `pr_status_serializes()`

---

## ✅ Well-Tested Module

### http_server/auth.rs (162 LOC, 6 tests)
**Best-tested module — good example to follow**

Tests:
- ✓ `extract_bearer_token_valid()`
- ✓ `extract_bearer_token_missing()`
- ✓ `extract_bearer_token_wrong_scheme()`
- ✓ `extract_query_token_valid()`
- ✓ `extract_query_token_with_other_params()`
- ✓ `extract_query_token_missing()`

---

## Recommended Testing Order

### Phase 1 - Data Integrity
1. **persistence.rs** - All user data depends on this
   - Unit tests for CRUD operations
   - Integration tests for file operations
   - Estimate: 8-12 tests

2. **chat_session.rs** - Chat persistence
   - Session lifecycle tests
   - Sequence number handling
   - Estimate: 8-10 tests

### Phase 2 - Core Features
3. **Agent modules** - Test each backend
   - Startup/shutdown/message flows
   - Estimate: 3-5 tests per agent (15-25 total)

4. **http_server/routes.rs** - API layer
   - Major command categories
   - Estimate: 15-20 integration tests

### Phase 3 - Infrastructure
5. **pty.rs** - Terminal integration
   - Lifecycle tests
   - Estimate: 4-6 tests

6. **http_server/websocket.rs** - Real-time
   - Subscription pattern tests
   - Estimate: 6-8 tests

### Phase 4 - Polish
7. **lib.rs** - Additional coverage
8. **approvals.rs** - User feature
9. **http_server/state.rs** - State management

---

## Testing Strategy Notes

1. **Test Tauri Commands** — Use `tauri::async_runtime::block_on()` for async commands
2. **Focus on Integration** — Test command dispatch, not just serialization
3. **Mock overseer-core** — Some tests may benefit from mocking the core library
4. **Test HTTP Layer** — Test routes with mock State objects
5. **Test Error Paths** — Many gaps exist around error handling

---

## Architectural Context

The low coverage is partially by design:
- **Thin Wrapper Pattern** — Most business logic lives in `overseer-core`
- **Reliance on Core Tests** — Assumption that overseer-core is comprehensively tested
- **Tauri Impedance** — Testing Tauri commands requires async runtime setup

What still needs testing here:
- Integration points with core
- Error handling and mapping
- Serialization between Rust and JSON
- State management and thread safety
- HTTP layer (auth, routing, WebSockets)
