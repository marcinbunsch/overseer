import { observer } from "mobx-react-lite"
import type { PendingToolUse } from "../../stores/WorkspaceStore"

interface ToolApprovalPanelProps {
  pendingTools: PendingToolUse[]
  onApprove: (toolId: string) => void
  onApproveAll: (toolId: string, scope: "tool" | "command") => void
  onDeny: (toolId: string) => void
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
}: ToolApprovalPanelProps) {
  if (pendingTools.length === 0) return null

  return (
    <div className="border-t border-ovr-border-subtle bg-ovr-bg-panel px-4 py-3">
      {pendingTools.map((tool) => {
        const hasPrefixes = tool.commandPrefixes && tool.commandPrefixes.length > 0
        const prefixDisplay = hasPrefixes ? formatPrefixes(tool.commandPrefixes!) : null

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
                onClick={() => onDeny(tool.id)}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Deny
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
})
