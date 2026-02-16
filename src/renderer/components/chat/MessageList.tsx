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
    if (!container) {
      console.log('[MessageList] checkIfAtBottom: no container')
      return false
    }

    const { scrollHeight, scrollTop, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const atBottom = distanceFromBottom <= SCROLL_THRESHOLD
    console.log('[MessageList] checkIfAtBottom:', {
      scrollHeight,
      scrollTop,
      clientHeight,
      distanceFromBottom,
      threshold: SCROLL_THRESHOLD,
      atBottom
    })
    return atBottom
  }, [])

  // Handle scroll events to detect manual scrolling
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom()
    console.log('[MessageList] handleScroll: setting isUserAtBottom =', atBottom)
    setIsUserAtBottom(atBottom)
  }, [checkIfAtBottom])

  // Auto-scroll to bottom if user is at bottom
  const scrollToBottom = useCallback(() => {
    const atBottom = checkIfAtBottom()
    console.log('[MessageList] scrollToBottom: atBottom =', atBottom)
    if (atBottom) {
      console.log('[MessageList] scrollToBottom: scrolling to bottom')
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
    } else {
      console.log('[MessageList] scrollToBottom: skipping (user not at bottom)')
    }
  }, [checkIfAtBottom])

  // Auto-scroll when a turn completes (existing behavior)
  useEffect(() => {
    console.log('[MessageList] turn completion effect:', { 
      turnsLength: turns.length, 
      lastResultMessageId 
    })
    if (lastResultMessageId) {
      console.log('[MessageList] turn completed: forcing scroll to bottom')
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
      setIsUserAtBottom(true) // Reset to true when turn completes
    }
  }, [turns.length, lastResultMessageId])

  // Auto-scroll during streaming when content grows
  useEffect(() => {
    const bottom = bottomRef.current
    if (!bottom) {
      console.log('[MessageList] ResizeObserver: no bottomRef')
      return
    }

    const observer = new ResizeObserver((entries) => {
      console.log('[MessageList] ResizeObserver triggered:', {
        entryCount: entries.length
      })
      scrollToBottom()
    })

    console.log('[MessageList] ResizeObserver: starting observation')
    observer.observe(bottom.parentElement!) // Observe the messages container

    return () => {
      console.log('[MessageList] ResizeObserver: disconnecting')
      observer.disconnect()
    }
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
