import { useState } from "react"
import { Globe, ChevronRight, ChevronDown } from "lucide-react"
import type { ToolCall } from "./parseToolCall"

export function WebFetchToolItem({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const url = typeof tool.input?.url === "string" ? tool.input.url : null
  const prompt = typeof tool.input?.prompt === "string" ? tool.input.prompt : null

  // Parse URL to get hostname and path
  let hostname = ""
  let pathname = ""
  if (url) {
    try {
      const parsed = new URL(url)
      hostname = parsed.hostname
      pathname = parsed.pathname
    } catch {
      // Invalid URL, just show raw
      hostname = url
    }
  }

  return (
    <div className="py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs hover:text-ovr-text-primary"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-ovr-text-muted" />
        ) : (
          <ChevronRight size={12} className="text-ovr-text-muted" />
        )}
        <Globe size={12} className="text-ovr-azure-400" />
        <span className="font-mono text-ovr-text-dim">WebFetch</span>
        {hostname && (
          <span className="truncate font-mono text-ovr-text-muted" title={url ?? undefined}>
            {hostname}
            {pathname && pathname !== "/" && <span className="text-ovr-text-dim">{pathname}</span>}
          </span>
        )}
      </button>
      {expanded && prompt && (
        <div className="mt-1 ml-6 rounded bg-ovr-bg-elevated px-2 py-1.5 text-xs text-ovr-text-muted">
          {prompt}
        </div>
      )}
    </div>
  )
}
