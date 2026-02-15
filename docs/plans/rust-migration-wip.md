# Rust Core Migration - Work in Progress

This document tracks the current state of the Rust core migration. For the full plan, see [rust-core-migration-plan.md](./rust-core-migration-plan.md).

## Current State (2026-02-16)

### Completed

#### Phase 1: Crate Structure Setup ✅
- `overseer-core` crate created at `crates/overseer-core/`
- Workspace structure in place
- No Tauri dependencies in core crate

#### Phase 2: Tool Approval Logic ✅
Fully implemented and wired end-to-end.

**Rust implementation (`overseer-core/src/approval/`):**
- `command_parser.rs` - Command prefix extraction for shell commands
- `safe_commands.rs` - List of safe (auto-approvable) read-only commands
- `context.rs` - `ApprovalContext` with `should_auto_approve()` method

**Tauri integration (`src-tauri/src/`):**
- `approvals.rs` - `ProjectApprovalManager` for per-project approval context management and persistence
- `agents/claude.rs` - Intercepts `ToolApproval` events, checks `should_auto_approve()`, auto-approves directly to agent stdin, emits events with `auto_approved: true`

**Frontend (presentation layer only):**
- `ToolApprovalPanel.tsx` - Renders approval UI for non-auto-approved tools
- `ChatStore.ts` - Receives events, shows pending approvals, sends user decisions back
- "Do something else" button for denying with explanation
- "Approve All" updates `ProjectApprovalManager` in Rust for persistence

**Key principle established:** Auto-approval decisions happen in Rust. The frontend only renders approvals and sends user decisions back.

#### Additional Completed Work
- **Shell utilities** moved to `crates/overseer-core/src/shell.rs`
- **Git operations** moved to `crates/overseer-core/src/git/` (Tauri wrappers call core)
- **Logging** moved to `crates/overseer-core/src/logging.rs` (re-exported in `src-tauri/src/logging.rs`)
- **Agent spawning/config** moved to `crates/overseer-core/src/spawn.rs` and `crates/overseer-core/src/agents/*/spawn.rs`
- **Agent protocol parsers** implemented in `crates/overseer-core/src/agents/*/parser.rs` (not wired yet)
- **Overseer actions** parsing moved to `crates/overseer-core/src/overseer_actions/` and exposed via `extract_overseer_blocks_cmd`
- **Session state + manager** implemented in `crates/overseer-core/src/session/`
- **Persistence modules** implemented in `crates/overseer-core/src/persistence/` (approvals, chat, index, projects)

**Claude agent fully migrated:**
- `src-tauri/src/agents/claude.rs` uses `ClaudeParser` from `overseer-core`
- Parses stdout through Rust parser, emits typed `AgentEvent` to frontend
- Frontend `src/renderer/services/claude.ts` receives pre-parsed events (no JSON parsing)

### In Progress

#### Phase 3: Agent Protocol Parsing (Other agents)
Core parsers exist but other agents still parse in TypeScript:
- `crates/overseer-core/src/agents/codex/parser.rs` - implemented, not wired
- `crates/overseer-core/src/agents/copilot/parser.rs` - implemented, not wired
- `crates/overseer-core/src/agents/gemini/parser.rs` - implemented, not wired
- `crates/overseer-core/src/agents/opencode/parser.rs` - implemented, not wired

Integration work needed for each:
- Create Tauri wrapper similar to `src-tauri/src/agents/claude.rs`
- Route stdout/stderr through core parser
- Remove duplicate parsing in `src/renderer/services/{codex,copilot,gemini,opencode}.ts`

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

### Immediate (Phase 3 Completion)

1. **Wire Codex agent to Rust parser**
   - Create `src-tauri/src/agents/codex.rs` similar to claude.rs
   - Use `CodexParser` from overseer-core
   - Add auto-approval logic
   - Simplify `src/renderer/services/codex.ts` to receive pre-parsed events

2. **Wire Copilot agent to Rust parser**
   - Same pattern as Codex

3. **Wire remaining agents (Gemini, OpenCode)**
   - Same pattern

### Medium Term

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
