# Overseer Actions Protocol

Agents can trigger actions in Overseer by outputting specially formatted code blocks. This provides an agent-agnostic way for any AI agent (Claude Code, Codex, OpenCode) to interact with the Overseer UI.

## Protocol Format

Output a fenced code block with language `overseer` containing JSON:

```overseer
{"action": "<action_name>", "params": {...}}
```

Overseer detects these blocks in agent output, executes the action, and removes the block from the displayed message.

## Available Actions

### `open_pr` - Create a Pull Request

Opens a PR creation flow for the current branch.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | Yes | PR title |
| `body` | string | No | PR description |

**Example:**
```overseer
{"action": "open_pr", "params": {"title": "Add dark mode support", "body": "This PR implements dark mode by..."}}
```

**Behavior:** Sends a message to the agent with a `gh pr create` command to execute.

---

### `merge_branch` - Merge Current Branch

Initiates a merge of the current branch into a target branch.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `into` | string | Yes | Target branch to merge into |

**Example:**
```overseer
{"action": "merge_branch", "params": {"into": "main"}}
```

**Behavior:** Sends a message to the agent requesting it perform the merge.

---

### `rename_chat` - Rename the Chat

Sets the chat's display title.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | Yes | New chat title |

**Example:**
```overseer
{"action": "rename_chat", "params": {"title": "Implementing user authentication"}}
```

**Behavior:** Immediately renames the chat tab/label. Shows a toast notification.

## Agent Integration

Overseer **automatically injects** the action instructions into every chat's init prompt. Agents receive the following instructions on their first message:

```markdown
## Overseer Actions

You are running inside Overseer, a desktop app for AI coding agents. You can trigger actions in Overseer by outputting a fenced code block with language "overseer":

​```overseer
{"action": "<action_name>", "params": {...}}
​```

Available actions:
- `rename_chat` - Set the chat title. Params: `title` (string). Use this after understanding the user's task to give the chat a descriptive name.
- `open_pr` - Create a GitHub PR. Params: `title` (string, required), `body` (string, optional)
- `merge_branch` - Merge current branch. Params: `into` (string, target branch)
```

This is appended to any user-defined init prompt configured in repo settings.

## UI Rendering

If an overseer block appears in displayed content (e.g., historical messages), it renders as a styled action card showing the action type and key parameters, rather than as raw JSON.

## Implementation Details

- **Parser:** `src/renderer/utils/overseerActions.ts`
- **Executor:** `src/renderer/services/overseerActionExecutor.ts`
- **Integration:** `ChatStore.handleAgentEvent()` extracts and executes actions
- **UI:** `MarkdownContent.tsx` renders action blocks with icons
