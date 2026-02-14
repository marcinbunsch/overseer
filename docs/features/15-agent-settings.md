# 15 — Agent Settings

## Goal

Allow users to configure which AI agents are available in Overseer and set a default agent for new chats. This feature provides fine-grained control over the agent selection experience.

---

## Features

### Enable/Disable Agents

Each agent (Claude, Codex, Copilot, Gemini, OpenCode) can be individually enabled or disabled via toggle switches in the Settings dialog.

- Disabled agents are hidden from the "New Chat" screen
- Disabled agents cannot be selected for new conversations
- If the default agent is disabled, the default resets to `null` (None)
- Agent availability status (installed/not installed) is independent of enabled/disabled state

### Default Agent Selection

Users can set a default agent that will be pre-selected when creating new chats:

- **None**: Shows the agent selection screen, user must choose an agent
- **Specific agent**: Automatically starts a new chat with that agent

The default agent dropdown only shows enabled agents. If an agent is disabled while set as default, the default automatically clears to None.

### Pending Chat Tabs

When no default agent is set and the user presses Cmd+T (or clicks + tab):

1. A new "pending" chat tab is created with no agent assigned
2. The NewChatScreen appears with "Select an agent" heading
3. User clicks an agent button to assign it to the pending chat
4. The chat then becomes a normal chat with that agent

---

## UI

### Settings Dialog

```
+------------------------------------------+
| Agents                                    |
|------------------------------------------|
| Available AI agents                       |
|                                          |
| Claude            [=========○] On        |
| Codex             [=========○] On        |
| Copilot           [○=========] Off       |
| Gemini            [=========○] On        |
| OpenCode          [○=========] Off       |
|                                          |
| Default Agent                             |
| [None ▾]                                 |
+------------------------------------------+
```

The toggle switches use Radix UI Switch component. The dropdown uses Radix UI Select.

### New Chat Screen (Standard)

When there are no chats and no default agent:

```
+------------------------------------------+
|            Start a new chat              |
|    Choose an AI agent to get started     |
|                                          |
|  [Claude]  [Codex]  [Gemini]  [OpenCode] |
|                                          |
+------------------------------------------+
```

Only enabled agents are shown.

### New Chat Screen (Pending Chat)

When a pending chat tab is active:

```
+------------------------------------------+
|            Select an agent               |
|    Choose an AI agent to get started     |
|                                          |
|  [Claude]  [Codex]  [Gemini]  [OpenCode] |
|                                          |
+------------------------------------------+
```

---

## Data Model

```typescript
interface Config {
  // ...existing fields...
  enabledAgents: AgentType[]   // List of enabled agents, defaults to all
  defaultAgent: AgentType | null  // Default agent or null for "None"
}

interface Chat {
  // ...existing fields...
  agentType?: AgentType  // Optional: undefined for pending chats
}
```

---

## ConfigStore API

```typescript
class ConfigStore {
  // Observable
  @observable enabledAgents: AgentType[] = ["claude", "codex", "copilot", "gemini", "opencode"]
  @observable defaultAgent: AgentType | null = "claude"

  // Actions
  @action setAgentEnabled(agent: AgentType, enabled: boolean): void
  @action setDefaultAgent(agent: AgentType | null): void

  // Computed
  isAgentEnabled(agent: AgentType): boolean
}
```

When `setAgentEnabled(agent, false)` is called and that agent is the current `defaultAgent`, the `defaultAgent` is automatically set to `null`.

---

## SessionStore API

```typescript
class SessionStore {
  // Creates a pending chat (no agent) or with specific agent
  @action newChat(agentType?: AgentType): void

  // Sets the agent on the currently active pending chat
  @action setActiveChatAgent(agentType: AgentType): void
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/types/index.ts` | Made `agentType` optional in `Chat` interface |
| `src/renderer/stores/ConfigStore.ts` | Added `enabledAgents`, `defaultAgent`, `setAgentEnabled`, `setDefaultAgent`, `isAgentEnabled` |
| `src/renderer/stores/SessionStore.ts` | Added `workspaceLoading`, updated `newChat` to accept optional agent, added `setActiveChatAgent` |
| `src/renderer/components/settings/Settings.tsx` | Added agent toggle switches and default agent dropdown |
| `src/renderer/components/chat/NewChatScreen.tsx` | Added `isPendingChat` prop, filters by enabled agents, calls appropriate store method |
| `src/renderer/components/chat/ChatWindow.tsx` | Shows `NewChatScreen` with `isPendingChat` when active chat has no agent |
| `src/renderer/components/chat/ChatTabs.tsx` | Updated to handle pending chats (shows "New Chat" label) |

---

## Persistence

Both `enabledAgents` and `defaultAgent` are persisted to `~/.config/overseer/config.json`:

```json
{
  "enabledAgents": ["claude", "codex", "gemini"],
  "defaultAgent": null
}
```

---

## Backward Compatibility

- Old config files without `enabledAgents` default to all agents enabled
- Old config files without `defaultAgent` or with a string value continue to work
- Old chat files without `agentType` are treated as legacy chats (behavior unchanged)
