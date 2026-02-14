import { useState } from "react"
import type { ToolCall } from "./parseToolCall"
import { EditDiffDialog } from "../../changes/EditDiffDialog"
import { countLines } from "../../../utils/text"

export function EditToolItem({ tool }: { tool: ToolCall }) {
  const filePath = typeof tool.input?.file_path === "string" ? tool.input.file_path : null
  const oldString = typeof tool.input?.old_string === "string" ? tool.input.old_string : ""
  const newString = typeof tool.input?.new_string === "string" ? tool.input.new_string : ""

  const fileName = filePath?.split("/").pop() ?? null

  // Prefer pre-computed toolMeta, fall back to parsing JSON for old messages
  let added: number
  let removed: number
  if (tool.toolMeta) {
    added = tool.toolMeta.linesAdded ?? 0
    removed = tool.toolMeta.linesRemoved ?? 0
  } else {
    removed = countLines(oldString)
    added = countLines(newString)
  }

  const [showDiff, setShowDiff] = useState(false)
  const canShowDiff = filePath && (oldString || newString)

  return (
    <>
      <div
        className={`flex items-center gap-2 py-0.5 text-xs ${canShowDiff ? "cursor-pointer rounded px-1 -ml-1 hover:bg-ovr-bg-elevated/50 transition-colors" : ""}`}
        onClick={canShowDiff ? () => setShowDiff(true) : undefined}
      >
        <span className="font-mono text-ovr-text-dim">Edit</span>
        {fileName && (
          <span className="truncate font-mono text-ovr-text-muted" title={filePath ?? undefined}>
            {fileName}
          </span>
        )}
        {(added > 0 || removed > 0) && (
          <span className="flex items-center gap-1.5 font-mono">
            {added > 0 && <span className="text-ovr-diff-add">+{added}</span>}
            {removed > 0 && <span className="text-ovr-diff-del">-{removed}</span>}
          </span>
        )}
        {!fileName && !added && !removed && (
          <span className="font-mono text-ovr-text-muted">{tool.toolName}</span>
        )}
      </div>
      {canShowDiff && (
        <EditDiffDialog
          open={showDiff}
          onOpenChange={setShowDiff}
          filePath={filePath}
          oldString={oldString}
          newString={newString}
        />
      )}
    </>
  )
}
