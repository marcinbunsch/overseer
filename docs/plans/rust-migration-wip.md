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

**Codex agent fully migrated:**
- `src-tauri/src/agents/codex.rs` uses `CodexParser` from `overseer-core`
- Parses stdout through Rust parser, emits typed `AgentEvent` via `codex:event:` events
- Auto-approval logic runs in Rust before events reach frontend
- Frontend `src/renderer/services/codex.ts` receives pre-parsed events (only handles JSON-RPC responses for client requests)

**Copilot agent fully migrated:**
- `src-tauri/src/agents/copilot.rs` uses `CopilotParser` from `overseer-core`
- Parses stdout through Rust parser, emits typed `AgentEvent` via `copilot:event:` events
- Auto-approval logic runs in Rust (shared `check_auto_approval()` helper)
- Frontend `src/renderer/services/copilot.ts` receives pre-parsed events (only handles JSON-RPC responses for client requests)

**Gemini agent fully migrated:**
- `src-tauri/src/agents/gemini.rs` uses `GeminiParser` from `overseer-core`
- Parses NDJSON stdout through Rust parser, emits typed `AgentEvent` via `gemini:event:` events
- No tool approvals (Gemini uses auto_approve mode)
- Frontend `src/renderer/services/gemini.ts` receives pre-parsed events

**OpenCode agent (parsing stays in TypeScript):**
- `src-tauri/src/agents/opencode.rs` only manages server process lifecycle
- OpenCode uses HTTP REST API via `@opencode-ai/sdk`, not stdout streaming
- TypeScript makes HTTP calls directly and parses responses
- No tool approvals (OpenCode uses permissive permissions `"*": "allow"`)

### In Progress

#### Phase 3: Agent Protocol Parsing ✅ COMPLETE
All agents now use Rust parsers where applicable:
- **Claude, Codex, Copilot, Gemini** - Rust parses stdout, emits typed events
- **OpenCode** - HTTP-based (parsing stays in TypeScript by design)
- Shared `check_auto_approval()` helper in `src-tauri/src/agents/mod.rs`

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

### Immediate (Phase 4)

1. **Move Overseer Actions execution to Rust**
   - Parsing is already in Rust (`extract_overseer_blocks`)
   - Move execution logic from `executeOverseerAction` in TypeScript to Rust
   - Types: `terminal-command`, `write-file`, `apply-diff`

### Medium Term (Phases 5-6)

1. **Chat persistence in Rust (Phase 5)**
   - Rust persistence modules exist (`overseer-core/src/persistence/`)
   - Wire into Tauri commands
   - Migrate file I/O from renderer stores to backend

2. **SessionManager integration (Phase 6)**
   - Session state + `SessionManager` exist in core
   - Wire into Tauri for state management
   - Enable multi-interface support (Tauri + SSH + Web)

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
- [ ] `pnpm test` passes (815 tests)
- [ ] `cargo test -p overseer-core` passes
- [ ] Manual testing of agent communication
- [ ] Manual testing of tool approval flow
