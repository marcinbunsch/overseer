# Rust Core Migration - Work in Progress

This document tracks the current state of the Rust core migration. For the full plan, see [rust-core-migration-plan.md](./rust-core-migration-plan.md).

## Current State (2026-02-15)

### Completed

#### Phase 1: Crate Structure Setup ✅
- `overseer-core` crate created at `crates/overseer-core/`
- Workspace structure in place
- No Tauri dependencies in core crate

#### Phase 2: Tool Approval Logic ✅ (Rust side complete, wiring pending)
The Rust side is complete, but the Tauri integration still needs wiring:

**Rust implementation (`overseer-core/src/approval/`):**
- `command_parser.rs` - Command prefix extraction for shell commands
- `safe_commands.rs` - List of safe (auto-approvable) read-only commands
- `context.rs` - `ApprovalContext` with `should_auto_approve()` method

**Frontend cleanup:**
- Removed frontend auto-approval decision logic
- Deleted `src/renderer/services/approval.ts`
- Removed `getCommandPrefixes`, `areCommandsSafe` from `src/renderer/types/index.ts`
- Removed `commandPrefixes` from `toolApproval` event type
- Removed `get_command_prefixes` Tauri command from `lib.rs`
- ChatStore now just adds all `toolApproval` events to pending list (no auto-approval)

**Key principle established:** Auto-approval decisions belong in Rust. The frontend only renders approvals and sends user decisions back.

#### Additional Completed Work
- **Shell utilities** moved to `crates/overseer-core/src/shell.rs`
- **Git operations** moved to `crates/overseer-core/src/git/` (Tauri wrappers call core)
- **Logging** moved to `crates/overseer-core/src/logging.rs` (re-exported in `src-tauri/src/logging.rs`)
- **Agent spawning/config** moved to `crates/overseer-core/src/spawn.rs` and `crates/overseer-core/src/agents/*/spawn.rs`
- **Agent protocol parsers** implemented in `crates/overseer-core/src/agents/*/parser.rs` (not wired yet)
- **Overseer actions** parsing moved to `crates/overseer-core/src/overseer_actions/` and exposed via `extract_overseer_blocks_cmd`
- **Session state + manager** implemented in `crates/overseer-core/src/session/`
- **Persistence modules** implemented in `crates/overseer-core/src/persistence/` (approvals, chat, index, projects)

### In Progress

#### Phase 2 Completion: Wire Approval to Backend
The Rust `ApprovalContext` exists but isn't wired into agent event handling yet. The flow should be:

1. Agent process sends `control_request` for tool approval
2. **Currently:** Event goes straight to frontend
3. **Goal:** Rust checks `ApprovalContext.should_auto_approve()`:
   - If safe → auto-approve, respond to agent, emit event with resolution already set
   - If not safe → emit `toolApproval` event for frontend to show

This requires:
- Using the existing session/state layer to hold `ApprovalContext` per session
- Intercepting `control_request` events in Rust before they reach the frontend
- Responding to agent process from Rust when auto-approving
- Keeping frontend approval UI + persistence (ProjectStore) as the presentation layer

#### Phase 3: Agent Protocol Parsing (Implemented in core, not wired)
Core parsers exist for all agent backends, but Tauri still forwards raw stdout and the frontend still parses:
- `crates/overseer-core/src/agents/claude/parser.rs`
- `crates/overseer-core/src/agents/codex/parser.rs`
- `crates/overseer-core/src/agents/copilot/parser.rs`
- `crates/overseer-core/src/agents/gemini/parser.rs`
- `crates/overseer-core/src/agents/opencode/parser.rs`

Integration work still needed:
- Route agent stdout/stderr through core parsers and emit `AgentEvent` from Rust
- Remove duplicate parsing paths in `src/renderer/services/*`

#### Phase 4: Overseer Actions Execution
Parsing is in Rust (`extract_overseer_blocks`), but execution still happens in TypeScript (`executeOverseerAction`).

#### Phase 5: Chat Persistence
Rust persistence modules exist, but file I/O still lives in TS stores:
- `ProjectStore` reads/writes approvals
- Chat/workspace persistence is still handled in the renderer

#### Phase 6: SessionManager
Session state + `SessionManager` exist in core, but aren't wired into Tauri yet.

---

## Next Steps

### Immediate (To Complete Phase 2)

1. **Create session state layer in Rust**
   - Already exists (`crates/overseer-core/src/session/state.rs`)
   - Wire it into the Tauri agent lifecycle so approval context persists across turns

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
crates/overseer-core/src/
├── lib.rs
├── approval/
│   ├── mod.rs
│   ├── command_parser.rs    # Extract prefixes from bash commands
│   ├── context.rs           # ApprovalContext with should_auto_approve()
│   └── safe_commands.rs     # SAFE_COMMANDS, SINGLE_WORD_COMMANDS
├── agents/
│   ├── mod.rs
│   ├── event.rs
│   ├── turn.rs
│   ├── claude/
│   ├── codex/
│   ├── copilot/
│   ├── gemini/
│   └── opencode/
├── git/
│   └── mod.rs               # Git operations (workspaces, diffs, merge)
├── logging.rs
├── overseer_actions/
│   └── mod.rs               # Parse <overseer-*> blocks
├── persistence/
├── session/
├── shell.rs                 # Login shell command building
└── spawn.rs                 # Agent process spawning
```

---

## Verification Checklist

After any changes:
- [ ] `pnpm checks` passes (format, lint, typecheck, rustcheck)
- [ ] `pnpm test` passes (809 tests)
- [ ] `cargo test -p overseer-core` passes
- [ ] Manual testing of agent communication
- [ ] Manual testing of tool approval flow
