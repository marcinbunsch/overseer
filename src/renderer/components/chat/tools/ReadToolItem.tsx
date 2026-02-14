import type { ToolCall } from "./parseToolCall"

export function ReadToolItem({ tool }: { tool: ToolCall }) {
  // Handle both file_path (Claude) and path (Copilot)
  const filePath =
    typeof tool.input?.file_path === "string"
      ? tool.input.file_path
      : typeof tool.input?.path === "string"
        ? tool.input.path
        : null

  // Show just the filename, full path as title
  const fileName = filePath?.split("/").pop() ?? null

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="font-mono text-ovr-text-dim">Read</span>
      {fileName ? (
        <span className="truncate font-mono text-ovr-text-muted" title={filePath ?? undefined}>
          {fileName}
        </span>
      ) : (
        <span className="font-mono text-ovr-text-muted">{tool.toolName}</span>
      )}
    </div>
  )
}
