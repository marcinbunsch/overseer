import { observer } from "mobx-react-lite"
import { useState } from "react"
import type { MessageTurn } from "../../types"
import { MessageItem } from "./MessageItem"
import { summarizeTurnWork } from "../../utils/chat"

interface TurnSectionProps {
  turn: MessageTurn
}

export const TurnSection = observer(function TurnSection({ turn }: TurnSectionProps) {
  const [expanded, setExpanded] = useState(false)

  const hasWork = turn.workMessages.length > 0
  const summary = hasWork ? summarizeTurnWork(turn.workMessages) : ""

  return (
    <div>
      {/* User message */}
      <MessageItem message={turn.userMessage} />

      {/* Collapsible work section */}
      {hasWork && (
        <div className="mb-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-ovr-text-muted hover:text-ovr-text-primary hover:bg-ovr-bg-elevated transition"
          >
            <span className="font-mono text-[10px]">{expanded ? "▼" : "▶"}</span>
            <span>{summary}</span>
            {turn.inProgress && (
              <span className="inline-block size-1.5 rounded-full bg-ovr-azure-500 animate-pulse" />
            )}
          </button>
          {expanded && (
            <div className="ml-3 border-l border-ovr-border-subtle pl-3">
              {turn.workMessages.map((msg) => (
                <MessageItem key={msg.id} message={msg} compact />
              ))}
            </div>
          )}
        </div>
      )}

      {/* In-progress indicator when no work messages yet */}
      {!hasWork && turn.inProgress && (
        <div className="mb-3 flex justify-start">
          <div className="rounded-lg bg-ovr-bg-panel px-3 py-4 text-sm">
            <span className="inline-block animate-pulse text-ovr-text-muted">...</span>
          </div>
        </div>
      )}

      {/* Result message */}
      {turn.resultMessage && <MessageItem message={turn.resultMessage} />}
    </div>
  )
})
