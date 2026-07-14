# Overseer

Oversee your AI coding agents (Claude Code, Codex, OpenCode).

## Design Principles

- **Open-source**: Fully open — take it, fork it, build on top of it.
- **Private**: No telemetry, no API keys, no cloud integrations. Overseer talks to CLI tools the user installs and controls locally. Never add analytics, tracking, or external service calls.
- **Performant**: No idle polling, no background refreshes, no wasted cycles. Everything is event-driven and reactive. Minimize resource usage — don't add timers, intervals, or periodic fetches.
- **Extensible**: The `AgentService` interface (`services/types.ts`) allows new agent backends to be added without modifying existing code. Keep this boundary clean.

## Tech Stack

- **Framework**: Tauri v2 (Rust backend + React frontend)
- **Frontend**: React 19, TypeScript 5.9, Vite 7
- **State Management**: MobX with `@observable`/`@computed`/`@action` decorators + `observer` HOC (never use `makeAutoObservable` or `makeObservable`)
- **Styling**: Tailwind CSS v4, dark theme, `ovr-` prefixed utility classes
- **UI Primitives**: Radix UI (AlertDialog, Toast)
- **Terminal**: xterm.js with custom PTY (via `portable-pty` in Rust)
- **Syntax Highlighting**: react-syntax-highlighter (Prism, oneDark theme)
- **Testing**: Vitest
- **Package Manager**: pnpm

## Architecture

### Two-process model

- **Rust backend** (`src-tauri/src/lib.rs`): Git workspace operations, agent process lifecycle (spawn/stdin/kill), Tauri commands.
- **React frontend** (`src/renderer/`): UI layer communicating via `invoke()` and `listen()`.

### Source structure

```
src/
├── renderer/
│   ├── App.tsx                # Root component, renders layout + toasts
│   ├── main.tsx               # Entry point
│   ├── stores/                # MobX singleton stores
│   │   ├── SessionStore.ts    # Chat sessions per workspace, Map<workspaceId, ChatStore[]>
│   │   ├── ChatStore.ts       # Per-chat state: messages, streaming, tool approvals
│   │   ├── RepoStore.ts       # Repos + workspaces, persisted to ~/.config/overseer/repos.json
│   │   ├── ConfigStore.ts     # App settings, persisted to ~/.config/overseer/config.json
│   │   ├── TerminalStore.ts   # Terminal connection state
│   │   └── ToastStore.ts      # Toast notification state
│   ├── services/
│   │   ├── claude.ts          # ClaudeAgentService (stream-json protocol)
│   │   ├── codex.ts           # CodexAgentService (JSON-RPC protocol)
│   │   ├── types.ts           # AgentService interface
│   │   ├── agentRegistry.ts   # Agent type → service mapping
│   │   ├── git.ts             # Git operations via Tauri commands
│   │   ├── terminal.ts        # Shell process for xterm.js
│   │   └── external.ts        # Launch VS Code, iTerm
│   ├── components/
│   │   ├── layout/            # Three-pane layout (Left, Middle, Right)
│   │   ├── repos/             # Repo/workspace management UI
│   │   ├── chat/              # Chat interface + tool renderers
│   │   ├── changes/           # Diff viewing (git diffs + edit/write diffs)
│   │   ├── terminal/          # xterm.js integration
│   │   └── shared/            # ConfirmDialog, Toasts
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   ├── utils/
│   │   └── groupMessagesIntoTurns.ts
│   └── types/
│       └── index.ts
├── styles/
│   ├── globals.css            # Global styles, animations
│   └── theme.css              # CSS custom properties (design tokens)
└── test/
    └── mocks/                 # Tauri/xterm test mocks
```

## Data Models

```typescript
interface Repo {
  id: string
  name: string
  path: string
  workspaces: Workspace[]
}

interface Workspace {
  id: string
  repoId: string
  branch: string
  path: string
  isArchived: boolean
  baseBranch: string
  createdAt: Date
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  toolMeta?: ToolMeta // Pre-computed metadata for tool calls (linesAdded/Removed)
}

interface ToolMeta {
  toolName: string
  linesAdded?: number
  linesRemoved?: number
}

interface ChangedFile {
  path: string
  status: string // M, A, D, R, ?
}
```

## Implemented Features

### Left Pane — Repository Management

- Add repositories via native folder picker
- Remove repos with confirmation dialog
- Expand/collapse repo to show workspaces
- Create workspaces (auto-named with animal names)
- Archive/delete workspaces with confirmation (optional branch deletion)
- Repository settings: init prompt, PR prompt, post-create command

### Middle Pane — Chat Interface

- Multiple conversation tabs per workspace (concurrent Claude processes)
- Streaming message display with markdown rendering
- Tool call rendering with specialized components per tool type
- Clickable Edit/Write tool items open syntax-highlighted diff dialogs
- Tool approval UI for permission prompts
- Agent question UI for AskUserQuestion tool (single/multi-select)
- Plan approval UI for ExitPlanMode with interactive plan review
- Collapsible turn sections grouping tool calls
- @ file search: type `@` to fuzzy-search and insert file paths

### Right Pane — Terminal + Changed Files

- Tabbed view: Terminal / Changes
- xterm.js terminal in workspace directory
- Changed files pane: git diff against base branch
- File diff dialog with syntax highlighting and file sidebar
- Line selection and commenting in diff views (sends to chat)
- Merge dialog with optional branch deletion
- GitHub PR status display on workspaces

### Diff System

- `diffRendering.tsx`: Shared diff utilities
  - `parseDiff()`: Parse unified git diff format
  - `buildDiffLines()`: Build diff from old/new strings (for Edit/Write tools)
  - `getLanguage()`: File extension → Prism language mapping
  - `HighlightedDiffTable`: Syntax-highlighted diff table with line numbers
  - `formatDiffComment()`: Format selected lines + comment for chat
  - Line selection (click + shift-click) with inline comment box
- `DiffDialog`: Full dialog for git file diffs (file sidebar, keyboard nav)
- `EditDiffDialog`: Lightweight dialog for Edit/Write tool call diffs

### Multi-Agent Support

- AgentService abstraction for different backends
- Claude Code via stream-json protocol
- Codex via JSON-RPC protocol
- Copilot, Gemini, and OpenCode support (beta)
- Agent registry for type → service mapping
- Per-chat model version selection (e.g., sonnet/opus/haiku for Claude, gpt-5.3-codex for Codex)
- Configurable model lists in `~/.config/overseer/config.json` (`claudeModels`, `codexModels`)
- Find current models: [Claude models](https://platform.claude.com/docs/en/about-claude/models/overview), [Codex models](https://developers.openai.com/codex/models/)

### Agent Settings

- Enable/disable individual agents in Settings
- Set a default agent for new chats (or "None" to always show agent picker)
- Pending chat tabs: Cmd+T creates a tab without an agent, user selects agent to start
- Disabled agents are hidden from the new chat screen
- See [features/15-agent-settings.md](features/15-agent-settings.md) for details

### Claude Protocol Features

- Thinking block display (collapsible extended thinking)
- Progressive tool display (`content_block_start` handling)
- Configurable permission mode (`default`, `acceptEdits`, `plan`)
- Graceful interrupt (SIGINT before force kill)
- Init prompt injection at session start
- See [features/10-claude-agent-protocol.md](features/10-claude-agent-protocol.md) for details

### Plan Review

- Interactive review dialog for agent plans (ExitPlanMode)
- View plans in markdown preview or code view
- Line selection with click, shift-click, or drag
- Add comments to selected lines
- Edit and remove comments in sidebar
- Submit formatted feedback for plan revision
- See [features/11-plan-review.md](features/11-plan-review.md) for details

### Other

- VS Code / iTerm integration (open workspace in external app)
- Editable branch names in chat header
- Toast notifications
- Keyboard shortcuts
- Persistent pane widths
- Chat history persistence to disk (lazy-loaded)

## UI Layout

```
+------------------+------------------------+------------------+
|                  |                        |                  |
|   LEFT PANE      |     MIDDLE PANE        |   RIGHT PANE     |
|                  |                        |                  |
|  [Add Repo]      |  [Tab1] [Tab2] [+]    |  [Terminal|Changes]|
|                  |  +------------------+  |                  |
|  ▼ repo-name  🗑 |  |                  |  |  Terminal:       |
|    + Add Workspace|  |   Chat Messages  |  |  ┌────────────┐ |
|    ├─ main       |  |   (streaming)    |  |  │ $ ls -la   │ |
|    ├─ feature-x  |  |                  |  |  │ > file.ts  │ |
|    └─ fix-bug    |  |   Tool calls:    |  |  └────────────┘ |
|                  |  |   Edit file +3-2 |  |                  |
|  ▼ another-repo  |  |   Write file +42 |  |  Changes:        |
|                  |  +------------------+  |  ├─ M file.ts    |
|                  |  |  [Input field]   |  |  ├─ A new.ts     |
|                  |  +------------------+  |  └─ D old.ts     |
+------------------+------------------------+------------------+
```

## Persistence

- **Repos**: `~/.config/overseer/repos.json`
- **Config**: `~/.config/overseer/config.json` (Claude/Codex paths, pane widths, model lists, enabled agents, default agent)
- **Chat history**: Per-chat JSON files, lazy-loaded on access
- **Workspace files**: `$HOME/overseer/workspaces/{repo}/{animal}/`

## Planned Features

See `docs/plans/` for detailed specs:

- **Result Metadata** — Surface cost, token usage, and duration from Claude result events
- **Overdrive** — Headless autonomous work engine in Rust: task ledger + scheduler + verified runs, daemon-first ([plans/overdrive.md](plans/overdrive.md))
