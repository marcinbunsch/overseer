# 09 — Model Version Selection

## Goal

Allow users to select which model to use on a **per-chat** basis. Both Claude and Codex agents support model selection. The selected model is passed to the respective CLI tool when starting a session.

---

## How It Works

Each chat has an optional `modelVersion` field (`string | null`). When `null`, no model flag is passed and the CLI tool uses its built-in default. When set, the model alias is passed to the CLI:

| Agent | CLI Flag | Example |
|---|---|---|
| Claude | `--model <alias>` | `claude --model opus -p "..." --resume ...` |
| Codex | `-c model="<alias>"` | `codex app-server -c model="gpt-5.3-codex"` |

**Important:** The model is fixed for the lifetime of a conversation. Once the first message is sent:
- **Claude**: The model is set via `--model` when the process starts. Follow-up messages reuse the same process (via `--resume`), so the model cannot change.
- **Codex**: The model is set when the `app-server` starts. Subsequent turns reuse the same server.

The model selector is disabled once a conversation has messages. To use a different model, start a new chat.

---

## Available Models

### Default Model Lists

Models are configured in `~/.config/overseer/config.json` under the `claudeModels` and `codexModels` fields. On first run, Overseer writes defaults:

**Claude models:**
```json
"claudeModels": [
  { "alias": "opus", "displayName": "Opus 4.6" },
  { "alias": "claude-opus-4-5", "displayName": "Opus 4.5" },
  { "alias": "sonnet", "displayName": "Sonnet 4.5" },
  { "alias": "haiku", "displayName": "Haiku 4.5" }
]
```

**Codex models:**
```json
"codexModels": [
  { "alias": "gpt-5.3-codex", "displayName": "GPT-5.3 Codex" },
  { "alias": "gpt-5.2-codex", "displayName": "GPT-5.2 Codex" },
  { "alias": "gpt-5.1-codex-max", "displayName": "GPT-5.1 Codex Max" },
  { "alias": "gpt-5.1-codex-mini", "displayName": "GPT-5.1 Codex Mini" }
]
```

### Customizing the Model List

There are two ways to use models not in the default list:

1. **Custom input in the UI** — The model selector dropdown includes a text input at the bottom. Type any model alias and press Enter. The alias is passed as-is to the CLI's `--model` / `-c model=` flag.

2. **Edit config.json** — Modify `~/.config/overseer/config.json` directly. Add, remove, or reorder entries in `claudeModels` or `codexModels`. Changes take effect on next app launch.

---

## UI

The model selector appears below the chat textarea, on the left side of the input area (opposite the Send/Stop button).

```
+------------------------------------------+
|                                          |
|  [Chat textarea]                         |
|                                          |
+------------------------------------------+
| [Default ▾]                    [  Send ] |
+------------------------------------------+
```

Clicking the selector opens an upward dropdown:

```
+---------------------+
| Default             |  ← null (no --model flag)
| Sonnet              |  ← "sonnet"
| Opus                |  ← "opus"
| Haiku               |  ← "haiku"
|---------------------|
| [Custom model...  ] |  ← free-text input
+---------------------+
| [Default ▾]                    [  Send ] |
```

- The currently selected model is highlighted in azure
- "Default" means no `--model` flag — the CLI uses whatever its built-in default is
- The selector is disabled once the conversation has any messages (model is locked for the session)

---

## Data Model

```typescript
interface AgentModel {
  alias: string       // Passed to CLI (e.g., "sonnet", "gpt-5.3-codex")
  displayName: string // Shown in the dropdown (e.g., "Sonnet", "GPT-5.3 Codex")
}

interface Chat {
  // ...existing fields...
  modelVersion: string | null  // Selected model alias, or null for default
}

interface ChatFile {
  // ...existing fields...
  modelVersion?: string | null  // Optional for backward compatibility
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/types/index.ts` | Added `AgentModel` interface, `modelVersion` to `Chat` and `ChatFile` |
| `src-tauri/src/agent.rs` | Added `model_version` param to `start_agent` and `start_codex_server` |
| `src/renderer/stores/ConfigStore.ts` | Added `claudeModels` and `codexModels` observables with defaults |
| `src/renderer/services/types.ts` | Added `modelVersion` param to `AgentService.sendMessage()` |
| `src/renderer/services/claude.ts` | Passes `modelVersion` to `invoke("start_agent")` |
| `src/renderer/services/codex.ts` | Passes `modelVersion` to `invoke("start_codex_server")` |
| `src/renderer/stores/ChatStore.ts` | Added `modelVersion` computed, `setModelVersion` action, persistence |
| `src/renderer/stores/SessionStore.ts` | Added `setModelVersion` delegate, `modelVersion: null` in chat creation |
| `src/renderer/components/chat/ModelSelector.tsx` | **New** — Dropdown component for model selection |
| `src/renderer/components/chat/ChatInput.tsx` | Integrated `ModelSelector` on the left side |
| `src/renderer/components/chat/ChatWindow.tsx` | Passes `modelVersion` and `onModelChange` to `ChatInput` |

---

## Backward Compatibility

- Old chat files without `modelVersion` default to `null` (no model flag, CLI default)
- Old config files without `claudeModels`/`codexModels` use the hardcoded defaults
- The `AgentModel` type is shared between Claude and Codex; each agent type has its own list
