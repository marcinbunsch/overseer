import { observer } from "mobx-react-lite"
import { Trash2 } from "lucide-react"

interface QueuedMessagesPanelProps {
  messages: string[]
  onRemove: (index: number) => void
}

export const QueuedMessagesPanel = observer(function QueuedMessagesPanel({
  messages,
  onRemove,
}: QueuedMessagesPanelProps) {
  if (messages.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t border-ovr-border-subtle bg-ovr-bg-base/50 px-4 py-3">
      <span className="text-xs text-ovr-text-dim">
        Queued messages (will send when agent finishes)
      </span>
      {messages.map((message, index) => (
        <div
          key={index}
          className="group flex items-start gap-2 rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel/50 px-3 py-2"
        >
          <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-ovr-text-muted">
            {message}
          </div>
          <button
            onClick={() => onRemove(index)}
            className="shrink-0 rounded p-1 text-ovr-text-dim opacity-0 transition-opacity hover:bg-ovr-bg-elevated hover:text-ovr-err group-hover:opacity-100"
            title="Remove from queue"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
})
