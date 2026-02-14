import { useState } from "react"
import type { ToolCall } from "./parseToolCall"
import cn from "classnames"

export function BashToolItem({ tool }: { tool: ToolCall }) {
  const description = typeof tool.input?.description === "string" ? tool.input.description : null
  const command = typeof tool.input?.command === "string" ? tool.input.command : null

  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div
      className="flex min-w-0 max-w-full items-start gap-2 overflow-hidden py-0.5 text-xs"
      onClick={() => setIsExpanded((prev) => !prev)}
    >
      <span className="shrink-0 font-mono text-ovr-text-dim">&gt;</span>
      {description && (
        <span
          className={cn("min-w-0 shrink-[0.1] text-ovr-text-primary", {
            truncate: !isExpanded,
          })}
        >
          {description}
        </span>
      )}
      {command && (
        <span
          className={cn("min-w-0 shrink-3 truncate font-mono text-ovr-text-muted", {
            truncate: !isExpanded,
          })}
        >
          {command}
        </span>
      )}
      {!description && !command && (
        <span className="min-w-0 truncate font-mono text-ovr-text-muted">{tool.toolName}</span>
      )}
    </div>
  )
}
