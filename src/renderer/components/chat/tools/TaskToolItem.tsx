import { useState } from "react"
import type { Message } from "../../../types"
import type { ToolCall } from "./parseToolCall"
import { parseToolCall } from "./parseToolCall"
import { ReadToolItem } from "./ReadToolItem"
import { GrepToolItem } from "./GrepToolItem"
import { GlobToolItem } from "./GlobToolItem"
import { BashToolItem } from "./BashToolItem"
import { EditToolItem } from "./EditToolItem"
import { WriteToolItem } from "./WriteToolItem"
import { GenericToolItem } from "./GenericToolItem"

interface TaskToolItemProps {
  tool: ToolCall
  /** Nested messages from the subagent (matching parentToolUseId) */
  nestedMessages?: Message[]
}

/** Map tool names to their compact renderers */
const nestedToolRenderers: Record<string, React.ComponentType<{ tool: ToolCall }>> = {
  Read: ReadToolItem,
  Grep: GrepToolItem,
  Glob: GlobToolItem,
  Bash: BashToolItem,
  Edit: EditToolItem,
  Write: WriteToolItem,
}

export function TaskToolItem({ tool, nestedMessages = [] }: TaskToolItemProps) {
  const [expanded, setExpanded] = useState(false)

  // Parse subagent_type and description from input
  const subagentType =
    typeof tool.input?.subagent_type === "string" ? tool.input.subagent_type : "Task"
  const description = typeof tool.input?.description === "string" ? tool.input.description : null

  // Count tool calls in nested messages
  const toolCallCount = nestedMessages.filter((m) => m.content.startsWith("[")).length

  return (
    <div className="py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
      >
        <span className="font-mono text-[10px]">{expanded ? "▼" : "▶"}</span>
        <span className="font-mono text-ovr-azure-400">[{subagentType}]</span>
        {description && (
          <span className="max-w-xs truncate text-ovr-text-primary">{description}</span>
        )}
        {toolCallCount > 0 && <span className="text-ovr-text-dim">({toolCallCount} tools)</span>}
      </button>

      {expanded && nestedMessages.length > 0 && (
        <div className="ml-4 mt-1 border-l border-ovr-border-subtle pl-2">
          {nestedMessages.map((msg) => {
            // Parse as tool call
            const nestedTool = parseToolCall(msg.content)
            if (!nestedTool) {
              // Text message - show truncated
              return (
                <div
                  key={msg.id}
                  className="truncate py-0.5 text-xs text-ovr-text-dim"
                  title={msg.content}
                >
                  {msg.content.slice(0, 80)}
                  {msg.content.length > 80 ? "..." : ""}
                </div>
              )
            }

            // Get the appropriate renderer
            const Renderer = nestedToolRenderers[nestedTool.toolName] ?? GenericToolItem

            return (
              <div key={msg.id} className="py-0.5">
                <Renderer tool={nestedTool} />
              </div>
            )
          })}
        </div>
      )}

      {expanded && nestedMessages.length === 0 && (
        <div className="ml-4 mt-1 text-xs text-ovr-text-dim">No nested tools yet</div>
      )}
    </div>
  )
}
