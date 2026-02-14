import { useState } from "react"
import type { ToolCall } from "./parseToolCall"
import { EditDiffDialog } from "../../changes/EditDiffDialog"
import { countLines } from "../../../utils/text"

export function WriteToolItem({ tool }: { tool: ToolCall }) {
  const filePath = typeof tool.input?.file_path === "string" ? tool.input.file_path : null
  const content = typeof tool.input?.content === "string" ? tool.input.content : ""

  const fileName = filePath?.split("/").pop() ?? null
  const lineCount = countLines(content)

  const [showDiff, setShowDiff] = useState(false)
  const canShowDiff = filePath && content

  return (
    <>
      <div
        className={`flex items-center gap-2 py-0.5 text-xs ${canShowDiff ? "cursor-pointer rounded px-1 -ml-1 hover:bg-ovr-bg-elevated/50 transition-colors" : ""}`}
        onClick={canShowDiff ? () => setShowDiff(true) : undefined}
      >
        <span className="font-mono text-ovr-text-dim">Write</span>
        {fileName ? (
          <span className="truncate font-mono text-ovr-text-muted" title={filePath ?? undefined}>
            {fileName}
          </span>
        ) : (
          <span className="font-mono text-ovr-text-muted">{tool.toolName}</span>
        )}
        {lineCount > 0 && <span className="font-mono text-ovr-diff-add">+{lineCount}</span>}
      </div>
      {canShowDiff && (
        <EditDiffDialog
          open={showDiff}
          onOpenChange={setShowDiff}
          filePath={filePath}
          oldString=""
          newString={content}
          label="Write"
        />
      )}
    </>
  )
}
