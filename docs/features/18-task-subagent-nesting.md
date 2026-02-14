# Task Tool Subagent Nesting

Display Claude's Task tool subagent messages nested under the parent Task, allowing users to expand and see what each subagent did during execution.

## Overview

When Claude uses the Task tool to spawn subagents (e.g., Explore, Plan), the subagent's tool calls are now grouped under the parent Task in the work section. This provides a cleaner view of agent activity and makes it easier to understand what each subagent accomplished.

## How It Works

### Claude CLI JSON Structure

When Claude calls the Task tool, the CLI emits:

1. **Task tool call** with a unique `id`:
```json
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "id": "toolu_01Mh...",
      "name": "Task",
      "input": {"subagent_type": "Explore", "description": "...", "prompt": "..."}
    }]
  },
  "parent_tool_use_id": null
}
```

2. **Subagent messages** with `parent_tool_use_id` matching the Task's `id`:
```json
{
  "type": "assistant",
  "message": { "content": [...] },
  "parent_tool_use_id": "toolu_01Mh..."
}
```

3. **Task result** when the subagent completes:
```json
{
  "type": "user",
  "message": {
    "content": [{
      "tool_use_id": "toolu_01Mh...",
      "type": "tool_result",
      "content": "..."
    }]
  }
}
```

### Implementation

**Parsing parent_tool_use_id** (`claude.ts`)

The Claude service extracts `parent_tool_use_id` from events and passes it through:

```typescript
const parentToolUseId = event.parent_tool_use_id

// For Task tools, include block.id so child messages can reference it
const toolUseId = block.name === "Task" ? block.id : undefined

this.emitEvent(chatId, {
  kind: "message",
  content: `[${block.name}]\n${input}`,
  parentToolUseId,
  toolUseId,
})
```

**Grouping messages** (`TurnSection.tsx`)

Messages are grouped by `parentToolUseId` before rendering:

```typescript
function groupWorkMessages(messages: Message[]): GroupedItem[] {
  const childrenByParent = new Map<string, Message[]>()

  // Build parent->children map
  for (const msg of messages) {
    if (msg.parentToolUseId) {
      const children = childrenByParent.get(msg.parentToolUseId) ?? []
      children.push(msg)
      childrenByParent.set(msg.parentToolUseId, children)
    }
  }

  // Group Task messages with their nested children
  for (const msg of messages) {
    if (msg.parentToolUseId) continue  // Skip children
    if (msg.toolUseId) {
      items.push({ type: "task", message: msg, nestedMessages: childrenByParent.get(msg.toolUseId) })
    } else {
      items.push({ type: "message", message: msg })
    }
  }
  return items
}
```

**TaskToolItem component** (`TaskToolItem.tsx`)

Renders the Task with collapsible nested messages:

```typescript
export function TaskToolItem({ tool, nestedMessages = [] }: TaskToolItemProps) {
  const [expanded, setExpanded] = useState(false)
  const subagentType = tool.input?.subagent_type ?? "Task"
  const description = tool.input?.description ?? null
  const toolCallCount = nestedMessages.filter((m) => m.content.startsWith("[")).length

  return (
    <div>
      <button onClick={() => setExpanded(!expanded)}>
        {expanded ? "▼" : "▶"} [{subagentType}] {description} ({toolCallCount} tools)
      </button>
      {expanded && nestedMessages.map(msg => <NestedToolRenderer msg={msg} />)}
    </div>
  )
}
```

## UI

**Collapsed:**
```
▶ [Explore] Explore codebase structure (14 tools)
```

**Expanded:**
```
▼ [Explore] Explore codebase structure (14 tools)
  ├─ Read package.json
  ├─ Read src/index.ts
  ├─ Grep "export"
  └─ ...
```

## Files

| File | Change |
|------|--------|
| `src/renderer/types/index.ts` | Add `parentToolUseId` and `toolUseId` to `Message` |
| `src/renderer/services/types.ts` | Add `parentToolUseId` and `toolUseId` to message event |
| `src/renderer/services/claude.ts` | Parse `parent_tool_use_id`, emit with events |
| `src/renderer/stores/ChatStore.ts` | Store parent IDs when adding messages |
| `src/renderer/components/chat/tools/TaskToolItem.tsx` | New component for Task rendering |
| `src/renderer/components/chat/tools/index.ts` | Export TaskToolItem |
| `src/renderer/components/chat/TurnSection.tsx` | Group messages by parent, render Tasks specially |

## Testing

1. Start a chat with Claude
2. Send a message that triggers Task tool usage:
   - `explore the codebase structure`
   - `plan how to add a new feature`
3. Wait for completion
4. Expand the work section (click the summary)
5. Verify Task items appear with nested tools
6. Click Task to expand and see nested tool calls
