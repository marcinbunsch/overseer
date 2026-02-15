# Rust Core Migration Plan: Making Frontend Dumb, Core Portable

## Goal

Create `overseer-core` crate containing all business logic, enabling three thin interface layers:
1. **Tauri commands** (desktop app)
2. **SSH TCP channel** (remote sessions)
3. **Web server** (future browser UI)

The frontend becomes a pure rendering layer: receive events → render UI → respond to prompts.

**Key insight**: Sessions are shared across interfaces. Start a chat in Tauri, continue from your phone via web.

---

## Current State

| Location | What's There | Status |
|----------|-------------|--------|
| `src-tauri/src/git.rs` | Git operations (807 lines) | Already Rust, needs extraction to core |
| `src-tauri/src/agents/` | Process spawning, I/O streaming | Already Rust, **move to core** |
| `src/renderer/types/index.ts` | Tool approval logic, SAFE_COMMANDS | **Migrate to Rust** |
| `src/renderer/services/*.ts` | Agent protocol parsing | **Migrate to Rust** |
| `src/renderer/stores/ChatStore.ts` | Chat persistence, event handling | **Migrate persistence to Rust** |
| `src/renderer/utils/overseerActions.ts` | Overseer block parsing | **Migrate to Rust** |

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERFACES (Thin Wrappers - just I/O translation)              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ Tauri Cmds  │  │ SSH Daemon   │  │ Web Server     │          │
│  │ src-tauri/  │  │ (JSON-RPC)   │  │ (REST/WS)      │          │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘          │
└─────────┼────────────────┼──────────────────┼───────────────────┘
          │                │                  │
          └────────────────┴──────────────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │  SessionManager (shared state)      │
         │  • Owns all active agent processes  │
         │  • Routes events to subscribers     │
         │  • Manages approval flow            │
         └──────────────────┬──────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  OVERSEER-CORE (ALL Business Logic)                              │
│  ┌────────────┐ ┌───────────────────┐ ┌────────────────┐        │
│  │ approval/  │ │ agents/           │ │ persistence/   │        │
│  │ • context  │ │ • event.rs        │ │ • chat.rs      │        │
│  │ • parser   │ │ • session.rs      │ │ • projects.rs  │        │
│  │ • safe_cmd │ │ • turn.rs         │ │ • approvals.rs │        │
│  └────────────┘ │ • claude/         │ │ • index.rs     │        │
│                 │ • codex/          │ └────────────────┘        │
│                 │ • copilot/        │                           │
│                 │ • gemini/         │                           │
│                 │ • opencode/       │                           │
│                 └───────────────────┘                           │
│  ┌────────────────────┐ ┌──────────────────────────┐            │
│  │ overseer_actions/  │ │ git/                     │            │
│  │ • parser.rs        │ │ • worktree.rs            │            │
│  │ • executor.rs      │ │ • diff.rs                │            │
│  └────────────────────┘ │ • merge.rs               │            │
│                         │ • branch.rs              │            │
│                         └──────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Crate Structure Setup

Create the `overseer-core` crate with workspace structure:

```
src-tauri/
├── Cargo.toml              # Workspace root
├── crates/
│   └── overseer-core/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── session/
│           │   ├── mod.rs
│           │   ├── manager.rs      # SessionManager - DI-friendly
│           │   └── state.rs        # Per-session state
│           ├── approval/
│           │   ├── mod.rs
│           │   ├── context.rs
│           │   ├── command_parser.rs
│           │   └── safe_commands.rs
│           ├── agents/
│           │   ├── mod.rs
│           │   ├── event.rs         # AgentEvent enum (shared)
│           │   ├── turn.rs          # Turn as first-class citizen
│           │   ├── spawn.rs         # Process spawning
│           │   ├── claude/          # Folder - will be large
│           │   │   ├── mod.rs
│           │   │   ├── parser.rs
│           │   │   └── types.rs
│           │   ├── codex/
│           │   │   └── ...
│           │   ├── copilot/
│           │   │   └── ...
│           │   ├── gemini/
│           │   │   └── ...
│           │   └── opencode/
│           │       └── ...
│           ├── persistence/
│           │   ├── mod.rs
│           │   ├── chat.rs
│           │   ├── projects.rs      # Project registry persistence
│           │   ├── approvals.rs
│           │   └── index.rs
│           ├── overseer_actions/
│           │   ├── mod.rs
│           │   └── executor.rs      # Fires events after turn completion
│           └── git/
│               ├── mod.rs
│               ├── worktree.rs      # Workspace/worktree management
│               ├── diff.rs          # Diff operations
│               ├── merge.rs         # Merge orchestration
│               └── branch.rs        # Branch operations
└── src/
    └── lib.rs                       # Thin Tauri command wrappers ONLY
```

**Key principle**: `overseer-core` has NO Tauri dependencies. Pure Rust with serde for serialization.

---

## Core Concept: SessionManager

The `SessionManager` is the heart of process sharing across interfaces:

```rust
// overseer-core/src/session/manager.rs
pub struct SessionManager {
    sessions: HashMap<SessionId, Session>,
}

impl SessionManager {
    /// Create new session, returns ID for future reference
    pub fn create_session(&mut self, config: SessionConfig) -> SessionId

    /// Attach to existing session (e.g., from web after starting in Tauri)
    pub fn attach(&self, session_id: SessionId) -> Result<SessionHandle>

    /// Detach from session (session keeps running)
    pub fn detach(&self, session_id: SessionId, subscriber_id: SubscriberId)

    /// Send user message to session
    pub fn send_message(&self, session_id: SessionId, message: &str) -> Result<()>

    /// Respond to pending approval/question
    pub fn respond(&self, session_id: SessionId, response: Response) -> Result<()>
}

pub struct Session {
    id: SessionId,
    agent_process: AgentProcess,
    current_turn: Option<Turn>,
    approval_context: ApprovalContext,
    event_subscribers: Vec<SubscriberId>,
}
```

Each interface (Tauri, SSH, Web) creates a `SessionManager` at startup and passes it to handlers.
Multiple interfaces in the same process share the same `SessionManager` instance.

---

## Core Concept: Turns

Turns are first-class citizens:

```rust
// overseer-core/src/agents/turn.rs
pub struct Turn {
    pub id: TurnId,
    pub user_message: String,
    pub events: Vec<TurnEvent>,      // All events within this turn
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: TurnStatus,
}

pub enum TurnStatus {
    InProgress,
    WaitingForApproval { request_id: String },
    WaitingForQuestion { request_id: String },
    WaitingForPlan { request_id: String },
    Completed,
    Cancelled,
}

pub struct TurnEvent {
    pub id: EventId,
    pub kind: AgentEvent,
    pub timestamp: DateTime<Utc>,
    pub resolution: Option<EventResolution>,  // Updated when user decides
}

pub struct EventResolution {
    pub decision: Decision,
    pub decided_at: DateTime<Utc>,
}

pub enum Decision {
    Approved,
    ApprovedAll,  // Also adds to approval context
    Denied { reason: Option<String> },  // With optional explanation for agent
    Answered { answers: Vec<Answer> },
    PlanApproved,
    PlanRejected { feedback: Option<String> },
}
```

When a turn completes:
1. All turn events are finalized
2. Overseer actions are extracted and processed
3. Events are persisted to chat log
4. `TurnComplete` event fired to subscribers

---

## Phase 2: Tool Approval Logic (Priority 1)

### The Key Insight

**Auto-approval is a backend decision, not a frontend query.** The backend:
1. Receives `control_request` from agent saying "I need approval"
2. Checks if it should auto-approve
3. If auto-approved → responds to agent immediately, emits event with `resolution: Some(Approved)`
4. If NOT auto-approved → emits `ToolApproval` event (with event ID), waits for frontend response

The frontend only sees what needs human decision. It responds with:
- **Approve** (once)
- **Approve All** (add to approved set for future)
- **Deny** with optional reason (tells agent what to do differently)

### Full Approval Flow

```rust
// In overseer-core, when agent sends control_request for tool approval
fn handle_control_request(session: &mut Session, request: ControlRequest) {
    let event_id = generate_event_id();
    let prefixes = parse_command_prefixes(&request.command);

    if session.approval_context.should_auto_approve(&request.tool, &prefixes) {
        // Auto-approve: respond to agent immediately
        session.agent_process.send_approval(request.request_id, true)?;

        // Emit event with resolution already set (for logging/display)
        session.emit(TurnEvent {
            id: event_id,
            kind: AgentEvent::ToolApproval { ... },
            resolution: Some(EventResolution {
                decision: Decision::Approved,
                decided_at: Utc::now(),
            }),
            ...
        });
    } else {
        // Need human decision: emit event, wait for response
        session.emit(TurnEvent {
            id: event_id,
            kind: AgentEvent::ToolApproval {
                request_id: request.request_id,  // Need this to respond later
                name: request.tool,
                input: request.input,
                prefixes: Some(prefixes),
            },
            resolution: None,  // Will be filled when user decides
            ...
        });

        session.current_turn.status = TurnStatus::WaitingForApproval {
            request_id: request.request_id
        };
    }
}

// When frontend calls respond()
fn handle_response(session: &mut Session, event_id: EventId, decision: Decision) {
    // Update the event with resolution
    if let Some(event) = session.current_turn.find_event_mut(event_id) {
        event.resolution = Some(EventResolution {
            decision: decision.clone(),
            decided_at: Utc::now(),
        });
    }

    // If "Approve All", update approval context
    if let Decision::ApprovedAll = &decision {
        session.approval_context.add_tool(tool_name);
        // or add_prefix for bash commands
    }

    // Send decision to agent
    let approved = !matches!(decision, Decision::Denied { .. });
    session.agent_process.send_approval(request_id, approved)?;

    // If denied with reason, send that as next message
    if let Decision::Denied { reason: Some(reason) } = decision {
        session.agent_process.send_message(&reason)?;
    }

    session.current_turn.status = TurnStatus::InProgress;
}
```

### Frontend (After Migration)

Frontend just renders approval prompts and sends responses:

```typescript
// When ToolApproval event arrives
renderApprovalPrompt(event)

// When user clicks button
invoke("respond_to_approval", {
    sessionId,
    eventId: event.id,
    decision: {
        kind: "approved" | "approved_all" | "denied",
        reason: optionalDenyReason
    }
})
```

---

## Phase 3: Agent Protocol Parsing & Spawning (Priority 2)

This is the most impactful migration - ~1500 lines of TS → Rust, plus process spawning.

### Process Spawning in Core

Process spawning moves to core because all interfaces (Tauri, SSH, Web) need it.
Sessions can be shared across interfaces via `SessionManager`.

```rust
// overseer-core/src/agents/spawn.rs
pub struct AgentProcess {
    stdin: ChildStdin,
    stdout_rx: Receiver<String>,
    stderr_rx: Receiver<String>,
}

impl AgentProcess {
    pub fn spawn(config: &AgentConfig) -> Result<Self>
    pub fn send_message(&mut self, message: &str) -> Result<()>
    pub fn send_approval(&mut self, request_id: &str, approved: bool) -> Result<()>
    pub fn send_answer(&mut self, request_id: &str, answers: &[Answer]) -> Result<()>
    pub fn kill(&mut self) -> Result<()>
}
```

### Unified Event Type

```rust
// overseer-core/src/agents/event.rs
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind")]
pub enum AgentEvent {
    // Streaming content
    Text { text: String },
    BashOutput { text: String },

    // Tool-related (messages from agent)
    Message {
        content: String,
        tool_meta: Option<ToolMeta>,
        parent_tool_use_id: Option<String>,
        tool_use_id: Option<String>,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },

    // Approval requests (agent asking for permission)
    ToolApproval {
        request_id: String,
        name: String,
        input: serde_json::Value,
        display_input: String,
        prefixes: Option<Vec<String>>,
    },
    Question {
        request_id: String,
        questions: Vec<QuestionItem>,
    },
    PlanApproval {
        request_id: String,
        content: String,
    },

    // Session lifecycle
    SessionId { session_id: String },
    TurnComplete,
    Done,
    Error { message: String },
}
```

### Per-Agent Parsers (Folders)

Each agent gets a folder since parsing logic is substantial:

```
agents/
├── claude/
│   ├── mod.rs       # Public API
│   ├── parser.rs    # Line-by-line parsing
│   ├── types.rs     # Claude-specific JSON types
│   └── tests.rs     # Parser tests
├── codex/
│   └── ...
├── opencode/
│   └── ...
```

---

## Phase 4: Overseer Actions (Priority 3)

Overseer actions are extracted and fired as events **after turn completion**:

```rust
// overseer-core/src/overseer_actions/mod.rs
pub enum OverseerAction {
    OpenPr { title: String, body: Option<String> },
    MergeBranch { into: String },
    RenameChat { title: String },
}

pub fn extract_overseer_blocks(content: &str) -> (String, Vec<OverseerAction>)

// overseer-core/src/overseer_actions/executor.rs
impl Session {
    fn on_turn_complete(&mut self) {
        // Extract actions from final message content
        let (clean_content, actions) = extract_overseer_blocks(&last_message);

        // Update message with cleaned content
        // ...

        // Fire events for each action
        for action in actions {
            self.emit(AgentEvent::OverseerAction { action });
        }
    }
}
```

The interface layer (Tauri/Web) receives `OverseerAction` events and handles them:
- `RenameChat` → update chat title
- `OpenPr` → open PR dialog/execute gh command
- `MergeBranch` → trigger merge flow

---

## Phase 5: Chat Persistence (Priority 4)

Move file I/O from ChatStore/WorkspaceStore to Rust:

```rust
// overseer-core/src/persistence/chat.rs
pub struct ChatPersistence { base_path: PathBuf }

impl ChatPersistence {
    pub fn save_chat(&self, chat: &ChatFile) -> Result<()>  // Atomic write
    pub fn load_chat(&self, id: &str) -> Result<ChatFile>
    pub fn list_chats(&self) -> Result<Vec<ChatIndexEntry>>
    pub fn archive_chat(&self, id: &str) -> Result<()>
}

// overseer-core/src/persistence/projects.rs
pub struct ProjectPersistence { ... }

impl ProjectPersistence {
    pub fn save_project(&self, project: &Project) -> Result<()>
    pub fn load_projects(&self) -> Result<Vec<Project>>
    // ...
}
```

---

## Phase 6: Git Operations (Priority 5)

Extract business logic from `src-tauri/src/git.rs` to `overseer-core/src/git/`.
Break into logical modules:

```rust
// overseer-core/src/git/worktree.rs
pub fn list_workspaces(repo_path: &Path) -> Result<Vec<Workspace>>
pub fn add_workspace(repo_path: &Path, branch: &str) -> Result<Workspace>
pub fn archive_workspace(workspace_path: &Path) -> Result<()>

// overseer-core/src/git/diff.rs
pub fn list_changed_files(workspace_path: &Path) -> Result<Vec<ChangedFile>>
pub fn get_file_diff(workspace_path: &Path, file: &str) -> Result<String>
pub fn get_uncommitted_diff(workspace_path: &Path) -> Result<String>

// overseer-core/src/git/merge.rs
pub fn check_merge(workspace_path: &Path) -> Result<MergeCheck>
pub fn merge_into_main(workspace_path: &Path) -> Result<MergeResult>

// overseer-core/src/git/branch.rs
pub fn rename_branch(repo_path: &Path, old: &str, new: &str) -> Result<()>
pub fn delete_branch(repo_path: &Path, branch: &str) -> Result<()>
```

---

## Migration Order

```
1. Crate setup (Phase 1)
   │
   ├── 2. Tool Approval (Phase 2) ──── No dependencies, security-critical
   │
   ├── 3. Overseer Actions (Phase 4) ── Simple, helps with Phase 3
   │
   ├── 4. Agent Parsing + Spawning (Phase 3) ──── Biggest impact
   │
   ├── 5. Chat Persistence (Phase 5) ──── After types stabilize
   │
   └── 6. Git Operations (Phase 6) ──── Can happen in parallel
```

---

## Interface Design: SSH & Web

Once `overseer-core` exists, the SSH daemon and web server become thin wrappers:

### SSH Daemon (JSON-RPC over TCP)

```rust
// crates/overseer-daemon/src/main.rs
let session_manager = Arc::new(Mutex::new(SessionManager::new()));

async fn handle_request(
    manager: Arc<Mutex<SessionManager>>,
    req: JsonRpcRequest,
) -> JsonRpcResponse {
    match req.method {
        "session.create" => manager.lock().create_session(...).into(),
        "session.attach" => manager.lock().attach(...).into(),
        "session.send" => manager.lock().send_message(...).into(),
        "session.respond" => manager.lock().respond(...).into(),
        "git.changedFiles" => overseer_core::git::list_changed_files(...).into(),
    }
}
```

### Web Server (REST + WebSocket)

```rust
// crates/overseer-server/src/main.rs (axum)
let session_manager = Arc::new(Mutex::new(SessionManager::new()));

async fn create_session(
    State(manager): State<Arc<Mutex<SessionManager>>>,
    Json(req): Json<CreateSessionRequest>,
) -> Json<SessionId> { ... }

async fn session_events(ws: WebSocket, session_id: SessionId) {
    // Forward TurnEvent stream over WebSocket
}
```

### Process Sharing Example

1. User starts Tauri app, creates session for chat → gets `session_id: "abc123"`
2. User opens web app on phone, calls `session.attach("abc123")`
3. Both interfaces receive the same events
4. User can type in either interface, both see the result
5. User closes Tauri, web continues working (session stays alive)

---

## Migration Workflow (Per Step)

Each migration step follows this cycle:

```
1. Implement Rust version in overseer-core
2. Add Tauri command wrapper
3. Update TS to call Rust (keep old TS code commented/disabled)
4. Commit: "feat: add Rust implementation of X"
5. You verify manually that everything works
6. You tell me to remove TS
7. Remove old TS implementation
8. Commit: "refactor: remove TS implementation of X"
9. Move to next step
```

This ensures:
- No breaking changes mid-migration
- Easy rollback if issues found
- Clear verification points
- Clean commit history

---

## Testing Strategy

1. **Unit tests in `overseer-core`** - Test pure logic
2. **Integration tests in Tauri** - Test command wrappers
3. **Manual verification** - You test each step before TS removal

---

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/Cargo.toml` | Add workspace, depend on overseer-core |
| `src-tauri/crates/overseer-core/*` | Create new crate |
| `src/renderer/types/index.ts` | Remove migrated logic |
| `src/renderer/services/*.ts` | Remove parsing, subscribe to events |
| `src/renderer/stores/ChatStore.ts` | Remove persistence & approval logic |
| `src-tauri/src/lib.rs` | Thin wrappers calling overseer-core |

---

## Verification

After each phase:
1. `pnpm checks` passes (UI + Rust)
2. `pnpm test` passes
3. Manual testing of affected workflows
4. No regressions in agent communication, approval flows, or persistence
