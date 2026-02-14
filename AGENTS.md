# AGENTS.md

Instructions for AI agents working on this codebase.

## Project Context

Overseer is a desktop GUI frontend for AI coding agents (Claude Code, Codex, OpenCode). See **[docs/OVERSEER.md](docs/OVERSEER.md)** for full architecture, component map, data models, and feature documentation.

## Key References

- [docs/OVERSEER.md](docs/OVERSEER.md) — Architecture, source structure, component map, data models, implemented features, planned features
- [CLAUDE.md](CLAUDE.md) — Development commands, pre-commit checklist, tech stack, key conventions
- [docs/claude-agent-sdk.md](docs/claude-agent-sdk.md) — Claude Agent SDK reference (query API, tools, hooks, subagents, MCP, permissions, sessions)
- [docs/features/](docs/features/) — Implemented feature specs
- [docs/plans/](docs/plans/) — Planned feature specs

## Design Principles

- **Private**: No telemetry, no API keys, no cloud integrations. Never add analytics, tracking, or external service calls.
- **Performant**: No idle polling, no background refreshes. Everything is event-driven and reactive. Minimize resource usage.
- **Extensible**: The `AgentService` interface allows new agent backends without modifying existing code. Keep this boundary clean.

## Development

- Package manager: **pnpm**
- Run `pnpm checks` before committing (or `pnpm checks:ui` for UI-only changes)
- Run `pnpm test` to verify changes
- Frontend: React 19 + TypeScript 5.9 + MobX + Tailwind CSS v4
- Backend: Tauri v2 (Rust) in `src-tauri/`

## MobX Conventions

- **NEVER use `makeAutoObservable` or `makeObservable`** — always use `@observable`, `@computed`, and `@action` decorators
- Decorators go on a **separate line above** the member they decorate:
  ```typescript
  @observable
  pending: PendingNote | null = null

  @action
  updateComment(text: string) {
    // ...
  }
  ```

## Finding Current Models

When updating model lists in `src/renderer/stores/ConfigStore.ts`, check these sources for the latest available models:

- **Claude**: [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- **Codex**: [OpenAI Models](https://platform.openai.com/docs/models) or [Codex Models](https://developers.openai.com/codex/models/)
