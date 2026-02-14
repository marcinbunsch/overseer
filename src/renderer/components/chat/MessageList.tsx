import { observer } from "mobx-react-lite"
import { useEffect, useRef, useState, useCallback } from "react"
import type { MessageTurn } from "../../types"
import { TurnSection } from "./TurnSection"

const TURNS_PER_PAGE = 10
const SCROLL_THRESHOLD = 50 // px from bottom to consider "at bottom"

interface MessageListProps {
  turns: MessageTurn[]
}

export const MessageList = observer(function MessageList({ turns }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(TURNS_PER_PAGE)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)

  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null
  const lastResultMessageId = lastTurn?.resultMessage?.id

  // Check if user is at bottom of scroll
  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return false

    const { scrollHeight, scrollTop, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    return distanceFromBottom <= SCROLL_THRESHOLD
  }, [])

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom()
    setIsUserAtBottom(atBottom)
  }, [checkIfAtBottom])

  // Auto-scroll to bottom if user is at bottom
  const scrollToBottom = useCallback(() => {
    if (isUserAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    }
  }, [isUserAtBottom])

  // Auto-scroll when a turn completes (existing behavior)
  useEffect(() => {
    if (lastResultMessageId) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
      setIsUserAtBottom(true) // Reset to true when turn completes
    }
  }, [turns.length, lastResultMessageId])

  // Auto-scroll during streaming when content grows
  useEffect(() => {
    const bottom = bottomRef.current
    if (!bottom) return

    const observer = new ResizeObserver(() => {
      scrollToBottom()
    })

    observer.observe(bottom.parentElement!) // Observe the messages container

    return () => observer.disconnect()
  }, [scrollToBottom])

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
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4">
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
