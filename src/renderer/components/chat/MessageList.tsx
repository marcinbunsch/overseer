import { observer } from "mobx-react-lite"
import { useRef, useState, useCallback, useEffect } from "react"
import type { MessageTurn } from "../../types"
import { TurnSection } from "./TurnSection"
import { useEventBus } from "../../utils/eventBus"
import { useDebouncedCallback } from "../../hooks/useDebuncedCallback"

const TURNS_PER_PAGE = 10
const SCROLL_THRESHOLD = 50 // px from bottom to consider "at bottom"

interface MessageListProps {
  turns: MessageTurn[]
}

export const MessageList = observer(function MessageList({ turns }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(TURNS_PER_PAGE)

  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false)

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "instant",
    })
    setShowNewMessageIndicator(false)
  }, [])

  // const scrollToBottomIfCloseToBottom = useCallback(() => {
  //   console.log("Checking if should auto-scroll to bottom...")
  //   const container = containerRef.current
  //   if (!container) return

  //   const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  //   if (distanceFromBottom < SCROLL_THRESHOLD) {
  //     console.log("Auto-scrolling to bottom...")
  //     scrollToBottom()
  //   } else {
  //     console.log("Not auto-scrolling, user is not close to bottom")
  //     setShowNewMessageIndicator(true)
  //   }
  // }, [scrollToBottom])

  const checkIfAtBottom = useDebouncedCallback(
    () => {
      const container = containerRef.current
      if (!container) return

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight
      const shouldHide = distanceFromBottom < SCROLL_THRESHOLD
      if (showNewMessageIndicator && shouldHide) {
        setShowNewMessageIndicator(false)
      }
    },
    16,
    []
  )

  useEventBus("agent:messageSent", scrollToBottom)

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
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4"
      onScroll={showNewMessageIndicator ? checkIfAtBottom : undefined}
    >
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
      {showNewMessageIndicator && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-ovr-bg-elevated text-ovr-text-primary px-4 py-2 rounded shadow">
          New message
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
})
