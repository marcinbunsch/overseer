import { observer } from "mobx-react-lite"
import { useMemo, useState } from "react"
import type { Message, MessageTurn } from "../../types"
import { MessageItem } from "./MessageItem"
import { summarizeTurnWork } from "../../utils/chat"
import { parseToolCall, TaskToolItem } from "./tools"

interface TurnSectionProps {
  turn: MessageTurn
}

/**
 * Group work messages so that Task tools are rendered with their nested subagent messages.
 * Returns an array of items to render: either a single message or a Task with its children.
 */
interface GroupedItem {
  type: "message" | "task"
  message: Message
  nestedMessages?: Message[]
}

function groupWorkMessages(messages: Message[]): GroupedItem[] {
  const items: GroupedItem[] = []
  const childrenByParent = new Map<string, Message[]>()
  const taskMessages = new Set<string>()

  // First pass: identify Task messages and build parent->children map
  for (const msg of messages) {
    // Check if this message has a parent (is a subagent message)
    if (msg.parentToolUseId) {
      const children = childrenByParent.get(msg.parentToolUseId) ?? []
      children.push(msg)
      childrenByParent.set(msg.parentToolUseId, children)
    }

    // Check if this is a Task message (has toolUseId)
    if (msg.toolUseId) {
      taskMessages.add(msg.id)
    }
  }

  // Second pass: build grouped items
  for (const msg of messages) {
    // Skip messages that are children of a Task (they'll be nested)
    if (msg.parentToolUseId) {
      continue
    }

    // Check if this is a Task message
    if (msg.toolUseId) {
      const nestedMessages = childrenByParent.get(msg.toolUseId) ?? []
      items.push({ type: "task", message: msg, nestedMessages })
    } else {
      items.push({ type: "message", message: msg })
    }
  }

  return items
}

export const TurnSection = observer(function TurnSection({ turn }: TurnSectionProps) {
  const [expanded, setExpanded] = useState(false)

  const hasWork = turn.workMessages.length > 0
  const summary = hasWork ? summarizeTurnWork(turn.workMessages) : ""

  // Group messages for rendering
  const groupedItems = useMemo(() => groupWorkMessages(turn.workMessages), [turn.workMessages])

  return (
    <div>
      {/* User message */}
      <MessageItem message={turn.userMessage} />

      {/* Collapsible work section */}
      {hasWork && (
        <div className="mb-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-ovr-text-muted transition hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
          >
            <span className="font-mono text-[10px]">{expanded ? "▼" : "▶"}</span>
            <span>{summary}</span>
            {turn.inProgress && (
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-ovr-azure-500" />
            )}
          </button>
          {expanded && (
            <div className="ml-3 border-l border-ovr-border-subtle pl-3">
              {groupedItems.map((item) => {
                if (item.type === "task") {
                  // Render Task with nested messages
                  const tool = parseToolCall(item.message.content)
                  if (tool) {
                    return (
                      <div key={item.message.id}>
                        <TaskToolItem tool={tool} nestedMessages={item.nestedMessages} />
                      </div>
                    )
                  }
                }
                // Regular message
                return <MessageItem key={item.message.id} message={item.message} compact />
              })}
            </div>
          )}
        </div>
      )}

      {/* In-progress indicator when no work messages yet */}
      {!hasWork && turn.inProgress && (
        <div className="mb-3 flex justify-start">
          <div className="rounded-lg bg-ovr-bg-panel px-3 py-4 text-sm">
            <span className="inline-block animate-pulse text-ovr-text-muted">...</span>
          </div>
        </div>
      )}

      {/* Result message */}
      {turn.resultMessage && <MessageItem message={turn.resultMessage} />}
    </div>
  )
})
