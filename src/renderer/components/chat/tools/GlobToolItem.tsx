import type { ToolCall } from "./parseToolCall"

export function GlobToolItem({ tool }: { tool: ToolCall }) {
  const pattern = typeof tool.input?.pattern === "string" ? tool.input.pattern : null

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="font-mono text-ovr-text-dim">Glob</span>
      {pattern ? (
        <span className="truncate font-mono text-ovr-text-muted">{pattern}</span>
      ) : (
        <span className="font-mono text-ovr-text-muted">{tool.toolName}</span>
      )}
    </div>
  )
}
