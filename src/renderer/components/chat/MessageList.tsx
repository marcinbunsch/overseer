import { observer } from "mobx-react-lite"
import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import type { MessageTurn } from "../../types"
import { TurnSection } from "./TurnSection"
import { useEventBus } from "../../utils/eventBus"
import { useDebouncedCallback } from "../../hooks/useDebuncedCallback"
import { chatSearchStore } from "../../stores/ChatSearchStore"

const TURNS_PER_PAGE = 10
const SCROLL_THRESHOLD = 50 // px from bottom to consider "at bottom"
// Above this total character count, search skips the full reveal (which would force-render
// every collapsed section at once) and covers only the paginated/expanded content instead.
const REVEAL_CHAR_CAP = 500_000

function totalContentChars(turns: MessageTurn[]): number {
  let total = 0
  for (const turn of turns) {
    total += turn.userMessage.content.length
    for (const work of turn.workMessages) total += work.content.length
    if (turn.resultMessage) total += turn.resultMessage.content.length
  }
  return total
}

interface MessageListProps {
  turns: MessageTurn[]
}

export const MessageList = observer(function MessageList({ turns }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(TURNS_PER_PAGE)

  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false)

  const scrollToBottomImmediate = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "instant",
    })
    setShowNewMessageIndicator(false)
  }, [])

  const scrollToBottom = useCallback(() => {
    // Wait for React to render the new content before scrolling
    // Double rAF ensures we're past both the React commit and browser paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottomImmediate()
      })
    })
  }, [scrollToBottomImmediate])

  const scrollToBottomIfCloseToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom < SCROLL_THRESHOLD) {
      scrollToBottom()
    } else {
      setShowNewMessageIndicator(true)
    }
  }, [scrollToBottom])

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
    16, // 60fps limit
    []
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only
  useEffect(scrollToBottom, [])
  useEventBus("agent:messageSent", scrollToBottom)
  useEventBus("agent:messageReceived", scrollToBottomIfCloseToBottom)

  // In-session search. A callback ref registers the scroll container as the search target —
  // it fires when the container actually attaches (which is after the empty-chat early return),
  // and with null on unmount. Kept in sync with containerRef for the scroll helpers above.
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    chatSearchStore.setContainer(el)
  }, [])

  // Close any search carried over from the previous chat (MessageList remounts per chat).
  useEffect(() => chatSearchStore.reset(), [])

  const searchActive = chatSearchStore.active
  const totalChars = useMemo(() => totalContentChars(turns), [turns])
  const tooBigToReveal = totalChars > REVEAL_CHAR_CAP
  const revealAll = searchActive && !tooBigToReveal

  useEffect(() => {
    chatSearchStore.setRevealCapped(searchActive && tooBigToReveal)
  }, [searchActive, tooBigToReveal])

  // Re-find matches after the reveal render commits and as content streams in — a stale range
  // can point at a node React has replaced. Debounced so token-by-token streaming doesn't thrash.
  const recomputeSearch = useDebouncedCallback(() => chatSearchStore.recompute(), 300, [])
  useEffect(() => {
    if (searchActive) recomputeSearch()
  }, [turns, searchActive, revealAll, recomputeSearch])

  if (turns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ovr-text-muted">
        Start a chat
      </div>
    )
  }

  // While search is active (and the session is small enough), reveal every turn so matches in
  // paginated-out turns are in the DOM and searchable.
  const hiddenCount = revealAll ? 0 : Math.max(0, turns.length - visibleCount)
  const visibleTurns = hiddenCount > 0 ? turns.slice(hiddenCount) : turns

  return (
    <div
      ref={attachContainer}
      className="flex-1 overflow-y-auto p-4"
      // Keep a scrolled-to match clear of the find bar floating at the top.
      style={{ scrollPaddingTop: 64 }}
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
