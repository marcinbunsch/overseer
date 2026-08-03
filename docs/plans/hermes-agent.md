# Add Hermes agent support

## Context

Overseer supports claude, codex, copilot, gemini, opencode, and pi. This adds **Hermes Agent** (Nous Research, hermes-agent.org) as a seventh backend.

Research findings that shape the design:

- Hermes ships an ACP (Agent Client Protocol) stdio server: `hermes acp` — JSON-RPC 2.0 over stdin/stdout. This is the same protocol Overseer's **Copilot** integration already speaks, so this is a second implementation of a known pattern, not a new protocol.
- Verified from Hermes source (`acp_adapter/` in NousResearch/hermes-agent):
  - `initialize` advertises `loadSession: true`; server runs the unstable ACP protocol.
  - `session/new {cwd, mcpServers}` returns `{sessionId, models, modes}`. `models` = `{available_models: [{model_id, name}], current_model_id}` (wire casing to be verified live — could be camelCase).
  - `session/load {cwd, sessionId}` replays the whole prior transcript as `session/update` notifications **before** returning; sessions persist in `~/.hermes/state.db`, so load works across process restarts.
  - `session/set_model {sessionId, modelId}` switches model at runtime. No `--model` spawn flag. No non-interactive CLI model listing exists.
  - `session/cancel` interrupts a turn. `session/update` kinds are the standard ACP set copilot already parses: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`.
  - `session/request_permission` option ids: `allow_once`, `allow_session`, `allow_always`, **`deny`**, `deny_always`. The deny id differs from Copilot's `reject_once`.

Decisions (fixed):
1. **Full resume across app restarts** via `session/load`, with replay suppression so the replayed transcript doesn't duplicate into Overseer's chat.
2. **Models from the session response, cached**: picker shows "Default" until the first session returns the list; cache it in config.json so later chats show it immediately.
3. No `models.json` entry (like Pi). No sandbox in v1. Binary path setting defaults to `hermes`, spawn args `["acp"]`.

## Approach

Clone the Copilot stack with four deltas: spawn command, deny option id, resume + replay suppression, runtime model discovery.

### 1. Rust: extract shared ACP parser, then add hermes module

Copilot's `types.rs` is pure JSON-RPC/ACP and its `parser.rs` would be byte-for-byte identical for Hermes (its copilot quirks are no-ops on Hermes input; permission option ids don't live in the parser). Zero parameters differ, so per the "extract only when variations reduce to 1–2 params" rule this is a legitimate extraction, not speculation:

- **Move** `crates/overseer-core/src/agents/copilot/{types.rs,parser.rs}` → `crates/overseer-core/src/agents/acp/`, rename `CopilotParser` → `AcpParser`. Tests move verbatim. `copilot/mod.rs` re-exports so `managers/copilot_agent.rs` changes minimally. Zero behavior change, proven by existing tests.
- **Create** `crates/overseer-core/src/agents/hermes/{mod.rs,spawn.rs}` — `HermesConfig { binary_path, shell_prefix }`, `build()` → `SpawnConfig::new(path, vec!["acp"])`. No model field.
- **Create** `crates/overseer-core/src/managers/hermes_agent.rs` — copy of `copilot_agent.rs` with:
  - `HermesStartConfig` (no `model_version`), channels `hermes:stdout|event|stderr|close:{id}`.
  - `suppress_replay: Arc<AtomicBool>` per process entry + `set_replay_suppression(server_id, bool)`. While suppressed: still emit raw `hermes:stdout` (TS needs it to resolve its pending requests), but skip `chat_sessions.append_event`, skip `hermes:event` emission, and skip auto-approval handling.
  - Auto-approve response keeps `allow_once` (valid for Hermes).
- **Edit** `crates/overseer-core/src/agents/mod.rs`, `managers/mod.rs`, `context.rs` (add `hermes_agents` manager, mirroring `copilot_agents`).
- **Create** `src-tauri/src/agents/hermes.rs` — `start_hermes_server`, `hermes_stdin`, `stop_hermes_server`, `hermes_set_replay_suppression`. Register in `src-tauri/src/agents/mod.rs` + `src-tauri/src/lib.rs` invoke_handler. Add the command names to the not-implemented arm in `crates/overseer-http/src/routes.rs`.

Replay suppression is TS-driven and race-free: TS sets the flag **before** writing `session/load`; ACP guarantees all replay notifications precede the load response; Rust processes stdout in order; TS clears the flag (in a `finally`) only after the load response resolves; Hermes emits nothing more until the next `session/prompt`.

### 2. TS service: `src/renderer/services/hermes.ts`

Copy of `copilot.ts` (`HermesAgentService implements AgentService`) with:

- `sendMessage` flow when process not running: attach listeners → `start_hermes_server` → `initialize` (read `agentCapabilities.loadSession`). **Do not clear `chat.sessionId`** (copilot.ts clears it at line 183 — that's exactly what we don't do; the id restored via `setSessionId` drives resume).
  - **Resume path** (sessionId present + loadSession): suppression on → `session/load {cwd, sessionId}` → apply model state → suppression off (finally). On JSON-RPC error **or** null result: clear sessionId, fall through.
  - **New-session path**: `session/new {cwd, mcpServers: []}` → store id → emit `{kind:"sessionId"}` (ChatStore already persists it: `ChatStore.ts:1155` sets `agentSessionId`, saved at 1523, restored at 1679/1703) → apply model state. Prepend `initPrompt` only when a brand-new session was created.
  - **Model sync** (every send): if `modelVersion && modelVersion !== chat.currentModelId` → `session/set_model`, update `chat.currentModelId`. Mid-chat model changes need no extra wiring — ChatStore passes `modelVersion` on each send (Pi does the same).
  - Then `session/prompt` as in copilot.
- `applyModelState(chatId, result)`: read `models` tolerating both snake_case and camelCase (`available_models`/`availableModels`, `model_id`/`modelId`, `current_model_id`/`currentModelId`), map to `AgentModel[] {alias, displayName}`, call `configStore.setHermesModels(list)`, set `chat.currentModelId`.
- `sendToolApproval`: approved → `"allow_once"`, denied → **`"deny"`** (hardcoded, matching copilot's style; plumbing the options list through `AgentEvent::ToolApproval` would be a cross-cutting schema change for no benefit).
- `interruptTurn` (`session/cancel` notification), `stopChat`, request/response bookkeeping: verbatim from copilot.

### 3. Registration + config + UI

- `AgentType` unions: `src/renderer/services/types.ts` and `src/renderer/types/index.ts`.
- `src/renderer/services/agentRegistry.ts` (singleton + factory case), `src/renderer/constants/agents.ts` (`hermes: "Hermes"`), `src/renderer/utils/agentDisplayName.ts`.
- `src/renderer/stores/ConfigStore.ts`: `hermesPath` (default `"hermes"`, expand/resolve in load, save), `defaultHermesModel`, **`hermesModels: AgentModel[]` persisted to config.json** (validated with `z.array(AgentModelSchema)` on load; `setHermesModels` skips save when unchanged), `ALL_AGENTS`, `getModelsForAgent`/`getDefaultModelForAgent` cases. Note: `piModels` is *not* persisted — persistence is the one new pattern here, justified because Hermes has no CLI listing to refresh from.
- `src/renderer/stores/ToolAvailabilityStore.ts`: `hermes` status + ensure/recheck via `check_command_exists`.
- `src/renderer/components/chat/ModelSelector.tsx`: `case "hermes": return configStore.hermesModels` (empty list already renders as just "Default"). No refresh-on-mount case.
- `src/renderer/components/shared/SettingsDialog.tsx`: AGENTS entry + settings block modeled on Pi's (path input, availability check, default-model selector; no extra settings).
- `src/renderer/components/chat/AgentIcon.tsx`, `NewChatScreen.tsx`, `ChatTabs.tsx`: icon + new-chat entry points gated on `isAgentEnabled("hermes")`.
- `src/renderer/stores/ChatStore.ts`: add `"hermes"` to the copilot/opencode/pi group in `getYoloModeValueForAgent`.

### 4. Tests

- Rust: existing ACP parser tests move with the extraction; add a Hermes-flavored permission test (`deny`/`allow_session` option ids still parse). Spawn test: args exactly `["acp"]`. Manager: `set_replay_suppression` toggling + a pure "should persist/emit this event?" helper testable without a process.
- TS `src/renderer/services/__tests__/hermes.test.ts` (template `copilot.test.ts`): approval ids (`allow_once`/`deny`), interrupt vs stop, **resume flow** (invoke order: suppression on → `session/load` with persisted id → suppression off → `session/prompt`; error fallback to `session/new` with suppression still cleared), **model caching** (`setHermesModels` called from session response; `session/set_model` sent only when modelVersion differs).
- `ConfigStore.test.ts`: `hermesModels` round-trip + `getModelsForAgent("hermes")`. Extend `SettingsDialog`/`AgentIcon` enumeration tests.

## Commit sequence (small commits, tests in each)

1. refactor(core): extract shared ACP parser (`agents/acp/`), copilot re-exports — zero behavior change. Includes this plan doc.
2. feat(core): hermes spawn + manager with replay suppression + context wiring.
3. feat(tauri): hermes commands (`start/stdin/stop/set_replay_suppression`) + registration + http allowlist.
4. feat(config): agent type unions, ConfigStore (path, persisted `hermesModels`, default model), ToolAvailabilityStore, titles/display name, yolo group.
5. feat(service): `services/hermes.ts` + registry + service tests.
6. feat(ui): SettingsDialog, ModelSelector, AgentIcon, NewChatScreen, ChatTabs.
7. chore: live-testing fixes (wire casing etc.) + docs.

## Verification

- `pnpm test` and `cargo test` (in `crates/overseer-core`) green at every commit; `pnpm checks` before finishing.
- Live test against a real `hermes acp` (requires `hermes` installed + a provider configured via `hermes model`):
  1. New Hermes chat → send message → streamed response, tool calls render, approval prompt appears; deny sends `optionId: "deny"` and Hermes actually stops the tool.
  2. Model picker populates after first session; pick a model → `session/set_model` sent; restart app → picker still populated from cache.
  3. Resume: chat, quit Overseer, reopen, continue the chat → Hermes remembers context, no duplicated messages in the transcript (suppression works).
  4. Resume fallback: delete `~/.hermes/state.db` session (or fake a stale id) → chat falls back to a fresh session without erroring.

## Known unknowns (resolve during implementation)

- Wire casing of the models field and `session/set_model` param name (`modelId` vs `model_id`) — service reads both casings inbound; outbound verified live.
- `session/load` failure mode: JSON-RPC error vs null result — service handles both.
- `tool_call.rawInput` key names for Bash prefix extraction/auto-approval — verify live, adjust display extraction only if needed.
- `agent_thought_chunk` maps to plain text (copilot behavior) in v1; a Pi-style thinking block is a possible follow-up.
