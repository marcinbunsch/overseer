# Init Prompt

The init prompt feature allows per-repository system prompts that are automatically sent at the start of every new chat session. This provides repository-specific context to the agent without requiring users to repeat instructions.

## Overview

Each repository can have an optional init prompt configured in its settings. When a new chat session starts, the init prompt is prepended to the user's first message.

## Use Cases

- Project-specific coding conventions
- Architecture guidelines
- Testing requirements
- Custom workflows
- File naming conventions
- Preferred libraries or patterns

## Configuration

Access via Repository Settings (gear icon on repo):

1. Click the settings icon on any repository in the left pane
2. Find the "Init Prompt" field
3. Enter your prompt text
4. Click Save

The prompt is stored per-repository in `~/.config/overseer/repos.json`.

## Behavior

**When injected:**

- Only on the first message of a new chat session
- Not on follow-up messages in existing sessions
- Not when resuming a previous conversation

**How injected:**

- Prepended to the user's message with a blank line separator
- Format: `{initPrompt}\n\n{userMessage}`

**Agent support:**

- Works with both Claude and Codex agents
- Each agent service handles injection in its message protocol

## Example

**Init Prompt:**

```
This is a React 19 project using TypeScript and MobX for state management.
Always use @observable decorators instead of makeAutoObservable.
Run `pnpm checks` before committing.
```

**User types:**

```
Add a logout button to the header
```

**Agent receives:**

```
This is a React 19 project using TypeScript and MobX for state management.
Always use @observable decorators instead of makeAutoObservable.
Run `pnpm checks` before committing.

Add a logout button to the header
```

## Implementation

### Storage

| Location                 | Purpose                          |
| ------------------------ | -------------------------------- |
| `types/index.ts`         | `Repo.initPrompt?: string` field |
| `RepoRegistry.ts`        | Persistence to repos.json        |
| `RepoSettingsDialog.tsx` | UI for editing                   |

### Injection Flow

1. `ChatStore.send()` checks if first message in session
2. Calls `context.getInitPrompt()` to retrieve prompt
3. `SessionStore` provides prompt from `repoRegistry.selectedRepo?.initPrompt`
4. Agent service prepends to message before sending

### Agent Services

**Claude** (`claude.ts`):

- Prepends on initial process start
- Format: `${initPrompt}\n\n${prompt}`

**Codex** (`codex.ts`):

- Checks `isNewSession = !chat.running`
- Only prepends on new sessions

## Related Settings

The repository settings dialog also includes:

- **PR Prompt**: Custom prompt for PR creation
- **Post-Create Command**: Shell command after workspace creation
