import { Search } from "lucide-react"
import type { ToolCall } from "./parseToolCall"

export function WebSearchToolItem({ tool }: { tool: ToolCall }) {
  const query = typeof tool.input?.query === "string" ? tool.input.query : null

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <Search size={12} className="text-ovr-azure-400" />
      <span className="font-mono text-ovr-text-dim">WebSearch</span>
      {query && <span className="truncate font-mono text-ovr-text-muted">{query}</span>}
    </div>
  )
}
