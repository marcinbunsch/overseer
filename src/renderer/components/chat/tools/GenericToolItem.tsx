import { useState } from "react"
import type { ToolCall } from "./parseToolCall"

export function GenericToolItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
      >
        <span className="font-mono">{expanded ? "▼" : "▶"}</span>
        <span className="font-mono">{tool.label}</span>
      </button>
      {expanded && tool.body && (
        <pre className="mt-2 max-h-75 overflow-auto whitespace-pre-wrap wrap-break-words font-mono text-xs text-ovr-text-muted">
          {tool.body}
        </pre>
      )}
    </div>
  )
}
