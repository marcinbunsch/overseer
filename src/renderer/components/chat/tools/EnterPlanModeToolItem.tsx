import { ClipboardList } from "lucide-react"
import type { ToolCall } from "./parseToolCall"

export function EnterPlanModeToolItem(_props: { tool: ToolCall }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <ClipboardList size={12} className="text-ovr-azure-400" />
      <span className="font-mono text-ovr-text-dim">Entering plan mode</span>
    </div>
  )
}
