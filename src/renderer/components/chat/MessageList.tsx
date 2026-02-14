import { observer } from "mobx-react-lite"
import { useEffect, useRef, useState } from "react"
import type { MessageTurn } from "../../types"
import { TurnSection } from "./TurnSection"

const TURNS_PER_PAGE = 10

interface MessageListProps {
  turns: MessageTurn[]
}

export const MessageList = observer(function MessageList({ turns }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(TURNS_PER_PAGE)

  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null
  const lastResultMessageId = lastTurn?.resultMessage?.id

  // Auto-scroll only when a turn completes (resultMessage exists)
  useEffect(() => {
    if (lastResultMessageId) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    }
  }, [turns.length, lastResultMessageId])

  if (turns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ovr-text-muted">
        Start a chat with Claude
      </div>
    )
  }

  const hiddenCount = Math.max(0, turns.length - visibleCount)
  const visibleTurns = hiddenCount > 0 ? turns.slice(hiddenCount) : turns

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {hiddenCount > 0 && (
        <button
          onClick={() => setVisibleCount((c) => c + TURNS_PER_PAGE)}
          className="mb-4 w-full rounded border border-ovr-border-subtle py-1.5 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
        >
          Show {Math.min(hiddenCount, TURNS_PER_PAGE)} earlier messages ({hiddenCount} hidden)
        </button>
      )}
      {visibleTurns.map((turn) => (
        <TurnSection key={turn.userMessage.id} turn={turn} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
})
