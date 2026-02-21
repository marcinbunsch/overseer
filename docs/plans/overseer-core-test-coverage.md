# overseer-core Test Coverage Report

**Generated:** 2026-02-21
**Location:** `crates/overseer-core`
**Overall Coverage:** 70% of files have tests (~40% average line coverage in tested files)

## Summary

The core library has **good test coverage** in parsing and business logic, but **critical gaps** in manager implementations that coordinate processes and persistence.

| Category | Files With Tests | Total Files | Coverage |
|----------|-----------------|-------------|----------|
| Parsers | 8/8 | 8 | ✅ 100% |
| Persistence | 5/6 | 6 | ✅ 83% |
| Agents (events/turns) | 6/6 | 6 | ✅ 100% |
| **Managers** | 0/7 | 7 | ❌ **0%** |
| Module re-exports | 0/11 | 11 | ⚪ N/A |

---

## 🔴 Tier 1 - Critical Gaps (No Tests + High Complexity)

These manager files coordinate processes, threading, and I/O — and have **zero tests**:

### managers/chat_session.rs (303 LOC)
**Manages chat persistence with buffered writes**

- Path validation, session registration/unregistration
- Event appending with time-based flushing
- Concurrent access handling

**Risks:** Path traversal, race conditions, data loss on flush failures

Missing tests:
- [ ] Register/unregister sessions
- [ ] Concurrent append operations
- [ ] Flush timing and batching
- [ ] Path component validation
- [ ] Seq numbering correctness
- [ ] File I/O error handling

### managers/claude_agent.rs (465 LOC)
**Claude process lifecycle management**

- Stdin/stdout handling, event parsing loop
- Auto-approval decision-making
- Session persistence integration

**Risks:** Approval bypass, event loss, zombie processes

Missing tests:
- [ ] Process spawn and lifecycle
- [ ] Event parsing and routing
- [ ] Auto-approval decision flow
- [ ] Approval context loading
- [ ] Error recovery

### managers/codex_agent.rs (349 LOC)
**Codex server management**

Similar complexity to Claude manager.

### managers/copilot_agent.rs (362 LOC)
**Copilot process management**

Similar complexity to Claude manager.

### managers/gemini_agent.rs (223 LOC)
**Gemini server/process management**

### managers/opencode_agent.rs (476 LOC)
**OpenCode HTTP server management**

- Port allocation and conflict resolution
- SSE event subscriptions
- Password generation

**Risks:** Port allocation failures, SSE subscription bugs

Missing tests:
- [ ] Port allocation and collision detection
- [ ] Server lifecycle (start/stop)
- [ ] SSE subscription handling

### managers/pty.rs (194 LOC)
**Pseudo-terminal management**

- PTY spawning, resizing, reading/writing

**Risks:** Resource leaks, terminal corruption

Missing tests:
- [ ] PTY spawning success/failure
- [ ] Resize operations
- [ ] Input/output handling
- [ ] Process exit handling

---

## 🟠 Tier 2 - Needs More Coverage

### spawn.rs (361 LOC, 12% coverage)
**Process spawning utilities**

Currently has minimal tests. Needs:
- [ ] Process creation configuration
- [ ] Event channel setup
- [ ] Error handling in spawn

### Agent spawn files (~200 LOC combined, ~35% coverage)
- `agents/claude/spawn.rs` (95 LOC)
- `agents/codex/spawn.rs` (53 LOC)
- `agents/copilot/spawn.rs` (54 LOC)

### approval/safe_commands.rs (270 LOC, 5% coverage)
Mostly constant lists, but validation logic exists.

---

## ✅ Well-Tested Areas

### Excellent Coverage (≥40%)

| File | LOC | Test % | Notes |
|------|-----|--------|-------|
| `approval/command_parser.rs` | 655 | **82%** | Comprehensive edge cases |
| `agents/event.rs` | 608 | **77%** | Event type coverage |
| `agents/turn.rs` | 692 | **72%** | Turn logic thoroughly tested |
| `overseer_actions/mod.rs` | 451 | **79%** | Action handling well-covered |
| `session/manager.rs` | 384 | **68%** | Session lifecycle tested |
| `persistence/projects.rs` | 374 | **59%** | Project persistence tested |
| `git/branch.rs` | 273 | **61%** | Branch operations covered |
| `persistence/index.rs` | 356 | **48%** | Index operations tested |
| `persistence/approvals.rs` | 488 | **43%** | Persistence logic covered |

### Good Coverage (25-40%)

| File | LOC | Test % | Notes |
|------|-----|--------|-------|
| `agents/claude/parser.rs` | 953 | 35% | Large file, parser tested |
| `agents/codex/parser.rs` | 840 | 31% | JSON-RPC parsing covered |
| `shell.rs` | 288 | 37% | Shell exit handling |
| `git/diff.rs` | 452 | 28% | File diff parsing tested |

---

## Recommended Testing Order

### Phase 1 - Critical (Manager Tests)

1. **managers/chat_session.rs** (~80 test cases)
   - Session lifecycle
   - Concurrent operations
   - Flush behavior
   - Path validation

2. **Agent manager threading tests** (~100+ test cases total)
   - Mock event loops
   - Auto-approval decision flow
   - Event persistence
   - Process lifecycle

3. **managers/pty.rs** (~40 test cases)
   - PTY lifecycle
   - Resize/write operations
   - Error handling

### Phase 2 - Important

4. **Enhance spawn.rs tests** (currently 12%)
5. **OpenCode manager tests** (~50 test cases)
6. **Add integration tests directory**

### Phase 3 - Polish

7. **Expand parser coverage** to 50%+
8. **Add usage.rs tests** (macOS keychain mocking)

---

## Test Quality Observations

### Strengths
- Command parser has excellent 82% coverage with edge cases
- Event system well-tested for serialization/deserialization
- Turn management thoroughly tested
- Persistence layer has good coverage

### Weaknesses
- **No integration tests directory** — all tests are inline `#[cfg(test)]` blocks
- **No concurrent/threading tests** — event loops in managers untested
- **Managers completely untested** — the coordination layer has 0% coverage

---

## Recommended Test Structure

```
crates/overseer-core/
├── src/
│   └── [existing inline #[cfg(test)] blocks]
├── tests/                                    (NEW)
│   ├── integration_chat_session.rs          (~80 cases)
│   ├── integration_agent_managers.rs        (~100+ cases)
│   ├── integration_pty.rs                   (~40 cases)
│   └── integration_end_to_end.rs            (~30 cases)
└── Cargo.toml [add: tempfile, tokio-test]
```

---

## Summary

| Metric | Value |
|--------|-------|
| Total files | 60 |
| Files with tests | 42 (70%) |
| Files without tests | 18 (30%) |
| Total LOC | ~18,092 |
| Test LOC | ~6,300+ |
| Highest coverage | `command_parser.rs` (82%) |
| Lowest coverage | `safe_commands.rs` (5%) |
| **Critical gap** | All 7 manager files (0%) |

The parsing layer is solid. The manager layer — where processes are coordinated and persistence happens — is completely untested. That's where the bugs will hide.
