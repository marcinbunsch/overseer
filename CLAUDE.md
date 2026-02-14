# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Overseer

Overseer is a desktop GUI frontend for AI coding agents (Claude Code, Codex, OpenCode). Built with Tauri v2, it provides a three-pane interface: repository/workspace management (left), chat with Claude (middle), and an integrated terminal with changed-files view (right).

For full architecture, component map, data models, and feature documentation, see **[docs/OVERSEER.md](docs/OVERSEER.md)**.

## Design Principles

These principles must guide all code changes:

- **Private**: No telemetry, no API keys, no cloud integrations. Overseer talks to CLI tools the user installs locally. Never add analytics, tracking, or external service calls.
- **Performant**: No idle polling, no background refreshes, no wasted cycles. Everything is event-driven and reactive. Minimize resource usage — don't add timers, intervals, or periodic fetches.
- **Extensible**: The agent abstraction (`AgentService` interface in `services/types.ts`) is designed so new agent backends can be added without modifying existing code. Keep this boundary clean.

## Development Commands

```bash
pnpm dev          # Full Tauri dev mode (frontend + Rust backend with hot reload)
pnpm build        # Production build (runs tsc + vite build + tauri build)
pnpm vite-dev     # Frontend-only dev server (no Tauri shell)
pnpm vite-build   # TypeScript check + Vite production build
pnpm test         # Run tests (vitest)
pnpm test:watch   # Run tests in watch mode
pnpm checks       # All checks: format + lint + typecheck + rustcheck
pnpm checks:ui    # UI-only checks: format + lint + typecheck
pnpm lint         # ESLint
pnpm format       # Prettier (write)
pnpm format:check # Prettier (check only)
```

Package manager is **pnpm** (v10.17.1).

## Pre-commit Checklist

Always run before committing:

```bash
pnpm checks       # Full check (UI + Rust)
pnpm checks:ui    # UI-only changes (no Rust check)
```

## Testing Requirements

When writing code, I must:

1. **Write tests** for new functionality
2. **Run all tests** (`pnpm test`) to ensure no regressions
3. **Fix any failing tests** caused by my changes

Do not consider a task complete until tests pass.

## Tech Stack

- **Desktop framework**: Tauri v2 (Rust backend in `src-tauri/`)
- **Frontend**: React 19, TypeScript 5.9, Vite 7
- **State management**: MobX with `makeObservable` + `observer` HOC
- **Styling**: Tailwind CSS v4 (dark theme, custom design tokens in `src/styles/theme.css`)
- **UI primitives**: Radix UI (AlertDialog for modals/confirms, Toast for notifications)
- **Terminal**: xterm.js with custom PTY (via `portable-pty` in Rust)
- **Syntax highlighting**: react-syntax-highlighter with Prism (oneDark theme)
- **Process communication**: Tauri event system (`emit`/`listen`)
- **Testing**: Vitest
- **Linting/Formatting**: ESLint + Prettier

## Key conventions

- **MobX stores** are singletons exported at module level. Components use `observer()` HOC. **NEVER use `makeAutoObservable` or `makeObservable`** — always use `@observable`, `@computed`, and `@action` decorators on separate lines above the member. This makes the store's reactive structure explicit and easier to debug.
- **Styling**: CSS custom properties in `src/styles/theme.css`, Tailwind utility classes prefixed `ovr-` (e.g., `ovr-btn`, `ovr-btn-danger`, `ovr-btn-ghost`, `ovr-btn-primary`, `ovr-panel`, `ovr-input`). Dark theme only. **Always use Tailwind's canonical class order** (as enforced by Prettier plugin).
- **Confirmation dialogs**: Use `ConfirmDialog` from `shared/ConfirmDialog.tsx`. Pattern: `useState` for pending state, render `<ConfirmDialog>` in JSX.
- **Diff viewing**: `diffRendering.tsx` exports shared utilities. `DiffDialog` for git diffs; `EditDiffDialog` for Edit/Write tool diffs.
- **Tool item rendering**: Each tool type has a component in `chat/tools/`. `parseToolCall.ts` extracts tool name and JSON input.
- **Toast notifications**: `toastStore.show("message")` from anywhere.

## Finding Current Models

When updating model lists in `src/renderer/stores/ConfigStore.ts`, check these sources for the latest available models:

- **Claude**: [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- **Codex**: [OpenAI Models](https://platform.openai.com/docs/models) or [Codex Models](https://developers.openai.com/codex/models/)
- **Copilot**: [Supported AI models for GitHub Copilot](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

## Scratchpad

**IMPORTANT: Read [SCRATCHPAD.md](SCRATCHPAD.md) at the start of every session.** It contains learned rules and patterns that must be followed.

The scratchpad has two sections:

1. **Rules** — High-level patterns and conventions I must follow (testing, architecture, etc.)
2. **Mistakes Log** — Past errors with context, for reference when similar situations arise

I should update the scratchpad during or after sessions when I learn something new. This helps me avoid repeating mistakes and builds institutional knowledge about this specific codebase.

## Reference

- [Full architecture & component map](docs/OVERSEER.md)
- [Claude Agent SDK](docs/claude-agent-sdk.md) — SDK documentation for building agents with Claude Code as a library
- [Feature specs](docs/features/) — Implemented feature documentation
- [Planned features](docs/plans/) — Upcoming feature specs
