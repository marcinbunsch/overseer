import { useState } from "react"
import { observer } from "mobx-react-lite"
import type { PendingToolUse } from "../../stores/WorkspaceStore"
import { Textarea } from "../shared/Textarea"

interface ToolApprovalPanelProps {
  pendingTools: PendingToolUse[]
  onApprove: (toolId: string) => void
  onApproveAll: (toolId: string, scope: "tool" | "command") => void
  onDeny: (toolId: string) => void
  onDenyWithExplanation: (toolId: string, explanation: string) => void
}

/**
 * Format command prefixes for display in the "Approve all" button.
 * For single commands: "cd"
 * For chained commands: "cd, pnpm install"
 */
function formatPrefixes(prefixes: string[]): string {
  return prefixes.join(", ")
}

export const ToolApprovalPanel = observer(function ToolApprovalPanel({
  pendingTools,
  onApprove,
  onApproveAll,
  onDeny,
  onDenyWithExplanation,
}: ToolApprovalPanelProps) {
  const [showFeedbackFor, setShowFeedbackFor] = useState<string | null>(null)
  const [feedback, setFeedback] = useState("")

  if (pendingTools.length === 0) return null

  return (
    <div className="border-t border-ovr-border-subtle bg-ovr-bg-panel px-4 py-3">
      {pendingTools.map((tool) => {
        const hasPrefixes = tool.commandPrefixes && tool.commandPrefixes.length > 0
        const prefixDisplay = hasPrefixes ? formatPrefixes(tool.commandPrefixes!) : null
        const showingFeedback = showFeedbackFor === tool.id

        return (
          <div
            key={tool.id}
            className="mb-2 last:mb-0 rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3"
          >
            <div className="mb-2 text-sm font-medium text-ovr-text-primary">Tool: {tool.name}</div>
            {tool.input && (
              <pre className="mb-2 max-h-32 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded bg-ovr-bg-panel p-2 text-xs text-ovr-text-muted">
                {tool.input}
              </pre>
            )}
            {showingFeedback ? (
              <div>
                <Textarea
                  autoFocus
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.metaKey && feedback.trim()) {
                      onDenyWithExplanation(tool.id, feedback)
                      setShowFeedbackFor(null)
                      setFeedback("")
                    }
                  }}
                  placeholder="Describe what you'd like the agent to do instead..."
                  rows={3}
                  className="mb-2 resize-none rounded px-2 py-1.5 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onDenyWithExplanation(tool.id, feedback)
                      setShowFeedbackFor(null)
                      setFeedback("")
                    }}
                    disabled={!feedback.trim()}
                    className="rounded bg-ovr-azure-500 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => {
                      setShowFeedbackFor(null)
                      setFeedback("")
                    }}
                    className="rounded border border-ovr-border-strong bg-ovr-bg-surface px-3 py-1 text-xs font-medium text-ovr-text-primary transition-colors hover:bg-ovr-bg-elevated"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onApprove(tool.id)}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  Approve
                </button>
                {hasPrefixes ? (
                  <>
                    <button
                      onClick={() => onApproveAll(tool.id, "command")}
                      className="rounded border border-green-600 px-3 py-1 text-xs font-medium text-green-400 transition-opacity hover:opacity-90"
                    >
                      Approve all "{prefixDisplay}"
                    </button>
                    <button
                      onClick={() => onApproveAll(tool.id, "tool")}
                      className="rounded border border-green-600 px-3 py-1 text-xs font-medium text-green-400 transition-opacity hover:opacity-90"
                    >
                      Approve all {tool.name}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => onApproveAll(tool.id, "tool")}
                    className="rounded border border-green-600 px-3 py-1 text-xs font-medium text-green-400 transition-opacity hover:opacity-90"
                  >
                    Approve all {tool.name}
                  </button>
                )}
                <button
                  onClick={() => setShowFeedbackFor(tool.id)}
                  className="rounded border border-ovr-border-strong bg-ovr-bg-surface px-3 py-1 text-xs font-medium text-ovr-text-primary transition-colors hover:bg-ovr-bg-elevated"
                >
                  Do something else
                </button>
                <button
                  onClick={() => onDeny(tool.id)}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})
