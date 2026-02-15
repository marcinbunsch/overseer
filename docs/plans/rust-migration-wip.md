# Rust Core Migration - Work in Progress

This document tracks the current state of the Rust core migration. For the full plan, see [rust-core-migration-plan.md](./rust-core-migration-plan.md).

## Current State (2026-02-15)

### Completed

#### Phase 1: Crate Structure Setup ✅
- `overseer-core` crate created at `src-tauri/crates/overseer-core/`
- Workspace structure in place
- No Tauri dependencies in core crate

#### Phase 2: Tool Approval Logic ✅ (Partial - Rust side complete)
The Rust side is complete, but the Tauri integration needs wiring:

**Rust implementation (`overseer-core/src/approval/`):**
- `command_parser.rs` - Command prefix extraction for shell commands
- `safe_commands.rs` - List of safe (auto-approvable) read-only commands
- `context.rs` - `ApprovalContext` with `should_auto_approve()` method

**Frontend cleanup (just completed):**
- Removed ALL approval logic from frontend
- Deleted `src/renderer/services/approval.ts`
- Removed `getCommandPrefixes`, `areCommandsSafe` from `src/renderer/types/index.ts`
- Removed `commandPrefixes` from `toolApproval` event type
- Removed `get_command_prefixes` Tauri command from `lib.rs`
- ChatStore now just adds all `toolApproval` events to pending list - no auto-approval

**Key principle established:** The frontend is "dumb" - it assumes it can run everything unless the backend tells it otherwise. Auto-approval decisions happen in Rust before events reach the frontend.

#### Additional Completed Work
- **Shell utilities** moved to `overseer-core/src/shell/`
- **Git operations** moved to `overseer-core/src/git/`
- **Logging** moved to `overseer-core/src/logging/`
- **Agent spawning** moved to `overseer-core/src/agents/` with per-agent modules
- **Overseer actions** parsing moved to `overseer-core/src/overseer_actions/`
- **Backend abstraction layer** for Tauri/Web portability

### In Progress

#### Phase 2 Completion: Wire Approval to Backend
The Rust `ApprovalContext` exists but isn't wired into the agent event handling yet. The flow should be:

1. Agent process sends `control_request` for tool approval
2. **Currently:** Event goes straight to frontend
3. **Goal:** Rust checks `ApprovalContext.should_auto_approve()`:
   - If safe → auto-approve, respond to agent, emit event with resolution already set
   - If not safe → emit `toolApproval` event for frontend to show

This requires:
- Creating a session/state layer that holds `ApprovalContext` per session
- Intercepting `control_request` events in Rust before they reach the frontend
- Responding to agent process from Rust when auto-approving

### Not Started

#### Phase 3: Agent Protocol Parsing (Priority 2)
Move ~1500 lines of TypeScript protocol parsing to Rust:
- `src/renderer/services/claude.ts` → `overseer-core/src/agents/claude/`
- `src/renderer/services/codex.ts` → `overseer-core/src/agents/codex/`
- `src/renderer/services/copilot.ts` → `overseer-core/src/agents/copilot/`
- etc.

#### Phase 4: Overseer Actions Execution
The parser exists in Rust (`extract_overseer_blocks`), but execution still happens in TypeScript.

#### Phase 5: Chat Persistence
Move file I/O from ChatStore/WorkspaceStore to Rust.

#### Phase 6: SessionManager
Create unified session management for process sharing across interfaces.

---

## Recent Changes (This Session)

### Files Modified
| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Removed `use overseer_core::approval;` import, removed `get_command_prefixes` command |
| `src/renderer/services/approval.ts` | **Deleted** - no longer needed |
| `src/renderer/services/types.ts` | Removed `commandPrefixes` from `toolApproval` event type |
| `src/renderer/services/claude.ts` | Removed `getCommandPrefixes` import and usage |
| `src/renderer/services/codex.ts` | Removed `getCommandPrefixes` import and usage |
| `src/renderer/services/copilot.ts` | Removed `getCommandPrefixes` import and usage |
| `src/renderer/types/index.ts` | Removed `getCommandPrefixes`, `getCommandPrefix`, `areCommandsSafe`, `SINGLE_WORD_COMMANDS`, `SAFE_COMMANDS` |
| `src/renderer/stores/ChatStore.ts` | Removed approval logic - now just adds all tool approvals to pending list |
| `src/renderer/stores/__tests__/ChatStore.test.ts` | Removed approval-related test mocks and expectations |
| `src/renderer/services/__tests__/claude.test.ts` | Removed approval function mocks |
| `src/renderer/services/__tests__/codex.test.ts` | Removed approval function mocks |
| `src/renderer/services/__tests__/copilot.test.ts` | Removed approval function mocks |
| `src/renderer/types/__tests__/commandPrefixes.test.ts` | **Deleted** - tests for removed TS functions |

### Lines Removed
Approximately **747 lines** of TypeScript code removed (approval logic, tests, command parsing).

---

## Next Steps

### Immediate (To Complete Phase 2)

1. **Create session state layer in Rust**
   - `overseer-core/src/session/state.rs` - Per-session state including `ApprovalContext`
   - Sessions need to persist approval context across turns

2. **Wire approval checking into agent event handling**
   - When `control_request` comes from agent, check `should_auto_approve()`
   - If approved → respond to agent immediately from Rust
   - If not → emit event to frontend

3. **Handle "Approve All" from frontend**
   - Frontend sends decision back to Rust
   - Rust updates `ApprovalContext` and responds to agent

### Medium Term (Phase 3)

1. Move protocol parsing to Rust (claude, codex, copilot, gemini, opencode)
2. Frontend just receives typed `AgentEvent` enums from Rust
3. All JSON parsing happens in Rust with proper error handling

### Long Term

1. SessionManager for multi-interface support (Tauri + SSH + Web)
2. Chat persistence in Rust
3. Full event-sourced architecture

---

## Architecture Notes

### Key Principle: Dumb Frontend
The frontend should NOT make decisions about:
- Whether to auto-approve a tool
- How to parse agent output
- What commands are safe

The frontend just:
1. Receives events from backend
2. Renders UI
3. Sends user decisions back to backend

### overseer-core Structure
```
src-tauri/crates/overseer-core/src/
├── lib.rs
├── approval/
│   ├── mod.rs
│   ├── command_parser.rs    # Extract prefixes from bash commands
│   ├── context.rs           # ApprovalContext with should_auto_approve()
│   └── safe_commands.rs     # SAFE_COMMANDS, SINGLE_WORD_COMMANDS
├── agents/
│   ├── mod.rs
│   ├── claude.rs
│   ├── codex.rs
│   ├── copilot.rs
│   ├── gemini.rs
│   └── opencode.rs
├── git/
│   └── mod.rs               # Git operations (workspaces, diffs, merge)
├── logging/
│   └── mod.rs
├── overseer_actions/
│   └── mod.rs               # Parse <overseer-*> blocks
└── shell/
    └── mod.rs               # Login shell command building
```

---

## Verification Checklist

After any changes:
- [ ] `pnpm checks` passes (format, lint, typecheck, rustcheck)
- [ ] `pnpm test` passes (809 tests)
- [ ] `cargo test -p overseer-core` passes
- [ ] Manual testing of agent communication
- [ ] Manual testing of tool approval flow
