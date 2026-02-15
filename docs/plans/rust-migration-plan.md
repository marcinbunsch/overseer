# Rust Migration Plan: Moving Business Logic from TypeScript to Rust

This document outlines what business logic currently lives in TypeScript that should move to Rust for a "dumb frontend" architecture.

## Current State Summary

| Category                | TypeScript Lines | Should Move?   |
| ----------------------- | ---------------- | -------------- |
| Tool Approval Logic     | ~200             | ✅ Yes         |
| Agent Protocol Parsing  | ~500             | ✅ Yes         |
| Chat Persistence        | ~300             | ✅ Yes         |
| Overseer Action Parsing | ~100             | ✅ Yes         |
| Merge Orchestration     | ~100             | ✅ Yes         |
| Message Turn Grouping   | ~50              | Optional       |
| Config Management       | ~200             | No (UI-driven) |

## Priority 1: High-Impact Migrations

### 1. Tool Approval Logic

**Currently in:** `ChatStore.ts`, `src/renderer/types/index.ts`

**What it does:**

- Determines if a tool should auto-approve
- Parses command prefixes from bash commands
- Checks against safe commands list
- Checks against user-approved tools/prefixes
- Makes approval decision

**Current TypeScript:**

```typescript
// types/index.ts
const SAFE_COMMANDS = new Set([
  "git status", "git diff", "git log", ...
])

export function areCommandsSafe(prefixes: string[]): boolean {
  return prefixes.every(p => SAFE_COMMANDS.has(p))
}

export function getCommandPrefixes(input): string[] {
  // Parses chained bash commands: cmd1 && cmd2; cmd3
}

// ChatStore.ts
const approvedTools = this.context.getApprovedToolNames()
const isSafeCommand = areCommandsSafe(event.commandPrefixes)
const allPrefixesApproved = event.commandPrefixes?.every(p =>
  approvedPrefixes.has(p)
)
const autoApproved = approvedTools.has(event.name) ||
  allPrefixesApproved || isSafeCommand
```

**Should become (Rust):**

```rust
// overseer-core/src/approval.rs
pub struct ApprovalContext {
    safe_commands: HashSet<String>,
    approved_tools: HashSet<String>,
    approved_prefixes: HashSet<String>,
}

impl ApprovalContext {
    pub fn should_auto_approve(&self, tool_name: &str, command_prefixes: &[String]) -> bool {
        // All logic here
    }

    pub fn parse_command_prefixes(bash_command: &str) -> Vec<String> {
        // Parse chained commands
    }
}
```

**Why move:**

- Approval decisions should be atomic with approval state
- Type safety for security-sensitive code
- Single source of truth

---

### 2. Agent Protocol Parsing

**Currently in:** `src/renderer/services/claude.ts`, `codex.ts`, etc.

**What it does:**

- Parses JSON lines from agent stdout
- Classifies event types (message, toolApproval, planApproval, etc.)
- Extracts metadata (tool use IDs, content, etc.)
- Emits structured events to UI

**Current TypeScript:**

```typescript
// claude.ts
interface ClaudeStreamEvent {
  type: string
  subtype?: string
  session_id?: string
  message?: { content: Array<{ type: string; text?: string }> }
}

private handleOutput(chatId: string, line: string) {
  const event: ClaudeStreamEvent = JSON.parse(line)
  switch(event.type) {
    case "message":
      this.processMessage(chatId, event)
      break
    case "toolApproval":
      this.eventCallbacks.get(chatId)?.(...)
      break
    // ... more cases
  }
}
```

**Should become (Rust):**

```rust
// overseer-core/src/agents/claude.rs
pub enum AgentEvent {
    Text { text: String },
    Message { content: String, tool_meta: Option<ToolMeta> },
    ToolApproval { id: String, name: String, input: Value, ... },
    PlanApproval { id: String, content: String },
    Done,
    Error { message: String },
}

pub fn parse_claude_output(line: &str) -> Result<AgentEvent, ParseError> {
    // Parse and classify
}
```

**Why move:**

- Already have this in `overseer-daemon` for remote sessions
- Consistency between local and remote
- Better error handling in Rust
- Performance for high-throughput agent output

---

### 3. Chat Persistence

**Currently in:** `ChatStore.ts`, `WorkspaceStore.ts`

**What it does:**

- Saves individual chat JSON files
- Loads chats from disk
- Manages chat index
- Handles chat archiving

**Current TypeScript:**

```typescript
// ChatStore.ts
async saveToDisk(): Promise<void> {
  const chatDir = await this.getChatDir()
  const data = { ... }
  await writeTextFile(`${chatDir}/chat.json`, JSON.stringify(data))
}

// WorkspaceStore.ts
async loadChatsFromDisk(): Promise<void> {
  const chatsPath = `${this.logDir}/chats`
  const entries = await readDir(chatsPath)
  for (const entry of entries) {
    const chatData = await readTextFile(`${chatsPath}/${entry.name}/chat.json`)
    // ...
  }
}
```

**Should become (Rust):**

```rust
// overseer-core/src/persistence/chat.rs
pub struct ChatPersistence {
    base_path: PathBuf,
}

impl ChatPersistence {
    pub fn save_chat(&self, chat: &Chat) -> Result<(), Error>;
    pub fn load_chat(&self, chat_id: &str) -> Result<Chat, Error>;
    pub fn list_chats(&self, workspace_path: &str) -> Result<Vec<ChatInfo>, Error>;
    pub fn archive_chat(&self, chat_id: &str) -> Result<(), Error>;
}
```

**Why move:**

- Backend becomes source of truth
- Atomic saves (no partial writes)
- Better file system handling
- Works with daemon for remote persistence

---

### 4. Overseer Action Parsing

**Currently in:** `src/renderer/utils/overseerActions.ts`, `ChatStore.ts`

**What it does:**

- Extracts `overseer` code blocks from agent output
- Parses action types (open_pr, merge_branch, etc.)
- Validates action parameters

**Current TypeScript:**

````typescript
const OVERSEER_BLOCK_REGEX = /```overseer\s*\n([\s\S]*?)\n```/g

export function extractOverseerBlocks(content: string): {
  cleanContent: string
  actions: OverseerAction[]
}
````

**Should become (Rust):**

```rust
// overseer-core/src/overseer_actions.rs
pub enum OverseerAction {
    OpenPr,
    MergeBranch,
    // ...
}

pub fn extract_overseer_actions(content: &str) -> (String, Vec<OverseerAction>) {
    // Parse and return clean content + actions
}
```

**Why move:**

- Part of agent output processing (goes with #2)
- Validation in Rust is more robust
- Could be combined with agent parsing

---

### 5. Merge Orchestration

**Currently in:** `ChangedFilesStore.ts`

**What it does:**

- Multi-step operation: merge → archive → delete branch → switch workspace
- Each step conditionally based on options
- State validation between steps

**Current TypeScript:**

```typescript
async merge(archiveAfter: boolean, deleteBranch: boolean): Promise<void> {
  const result = await gitService.mergeIntoMain(this.workspacePath)
  if (result.success) {
    if (archiveAfter) {
      await projectRegistry.archiveWorkspace(this.workspaceId)
      if (deleteBranch && branchName && projectPath) {
        await gitService.deleteBranch(projectPath, branchName)
      }
    }
    projectRegistry.switchToMainWorkspace(project.id)
  }
}
```

**Should become (Rust):**

```rust
// overseer-core/src/git.rs or new orchestration module
pub struct MergeOptions {
    pub archive_after: bool,
    pub delete_branch: bool,
}

pub fn merge_workspace(
    workspace_path: &str,
    project_path: &str,
    branch: &str,
    options: MergeOptions,
) -> Result<MergeResult, Error> {
    // Atomic multi-step operation
}
```

**Why move:**

- Atomic operation (all or nothing)
- No race conditions from async TypeScript
- Backend owns workspace state

---

## Priority 2: Medium-Impact Migrations

### 6. Approval State Persistence

**Currently in:** `ProjectStore.ts`

**What it does:**

- Maintains `approvedToolNames: Set<string>`
- Maintains `approvedCommandPrefixes: Set<string>`
- Persists to `~/.config/overseer/approvals.json`

**Should move:** Combine with #1 (Tool Approval Logic)

---

### 7. PR Status Caching

**Currently in:** `ChangedFilesStore.ts`

**What it does:**

- Debounces rapid gh CLI calls
- Caches PR status with staleness check

**Should become (Rust):**

- Cache in Rust with configurable TTL
- Expose via Tauri command with cache behavior

---

## What Stays in TypeScript

### UI State (Should Stay)

- Selected chat/workspace
- Scroll positions
- Expanded/collapsed sections
- Draft text in input fields
- Dialog open/close state

### Configuration Display (Should Stay)

- Model lists (hardcoded, display-only)
- UI preferences
- Theme settings

---

## Target Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (TypeScript/React)                    │
│  ┌───────────────────────────────────────────┐  │
│  │ Pure UI Components                        │  │
│  │ - Render state from stores                │  │
│  │ - Fire events to invoke Tauri commands    │  │
│  │ - No business logic                       │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ MobX Stores (UI STATE ONLY)               │  │
│  │ - selectedChatId, selectedWorkspaceId     │  │
│  │ - loading states, error states            │  │
│  │ - draft text, expanded sections           │  │
│  │ - Receive data via Tauri events           │  │
│  └───────────────────────────────────────────┘  │
└──────────────── Tauri IPC ─────────────────────┘
                      │
┌──────────────────────────────────────────────────┐
│  Backend (Rust - overseer-core)                  │
│  ┌───────────────────────────────────────────┐  │
│  │ High-Level Commands                       │  │
│  │ - send_message(chat_id, content)          │  │
│  │ - approve_tool(chat_id, tool_id, allow)   │  │
│  │ - merge_and_archive(workspace_id, opts)   │  │
│  │ - get_workspace_state(workspace_id)       │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Business Logic (overseer-core)            │  │
│  │ - approval.rs: Tool approval decisions    │  │
│  │ - agents/*.rs: Protocol parsing           │  │
│  │ - persistence/*.rs: Chat/approval storage │  │
│  │ - git.rs: Git operations & orchestration  │  │
│  │ - overseer_actions.rs: Action parsing     │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Low-Level (existing)                      │  │
│  │ - Process spawning, SSH, PTY              │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Migration Order

1. **Agent Protocol Parsing** - Highest ROI, already partially done in daemon
2. **Tool Approval Logic** - Security-sensitive, should be in Rust
3. **Chat Persistence** - Makes backend authoritative
4. **Merge Orchestration** - Atomicity benefits
5. **Overseer Actions** - Follows from #1

---

## Estimated Complexity Reduction

| Store             | Current Lines | After Migration | Reduction |
| ----------------- | ------------- | --------------- | --------- |
| ChatStore         | 780           | ~300            | 62%       |
| WorkspaceStore    | 825           | ~400            | 52%       |
| ChangedFilesStore | 405           | ~200            | 51%       |
| **Total**         | **2010**      | **~900**        | **55%**   |

The frontend becomes a thin rendering layer that:

1. Invokes Tauri commands
2. Receives events via Tauri event system
3. Renders UI from received state
