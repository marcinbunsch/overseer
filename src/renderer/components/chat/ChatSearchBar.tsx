import { observer } from "mobx-react-lite"
import { useEffect, useRef } from "react"
import { ChevronUp, ChevronDown, X } from "lucide-react"
import { chatSearchStore } from "../../stores/ChatSearchStore"

/**
 * Floating find bar over the message list, shown while search is active. Enter / Shift+Enter
 * move between matches, Esc closes. Opening is driven by the Cmd/Ctrl-F keyboard shortcut.
 */
export const ChatSearchBar = observer(function ChatSearchBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const active = chatSearchStore.active

  // Focus (and re-focus on re-open) the input when search becomes active.
  useEffect(() => {
    if (active) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [active])

  if (!active) return null

  const { query, matchCount, currentIndex, revealCapped } = chatSearchStore

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      if (e.shiftKey) chatSearchStore.prev()
      else chatSearchStore.next()
    } else if (e.key === "Escape") {
      e.preventDefault()
      chatSearchStore.close()
    }
  }

  const counter = counterLabel(query, matchCount, currentIndex)

  return (
    <div
      data-testid="chat-search-bar"
      className="absolute right-3 top-3 z-20 flex flex-col gap-1 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-2 py-1.5 shadow-lg"
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => chatSearchStore.setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find in chat"
          spellCheck={false}
          autoComplete="off"
          data-testid="chat-search-input"
          className="w-48 bg-transparent text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted"
        />
        <span
          data-testid="chat-search-counter"
          className="min-w-14 text-right text-xs tabular-nums text-ovr-text-muted"
        >
          {counter}
        </span>
        <button
          onClick={() => chatSearchStore.prev()}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter)"
          className="rounded p-0.5 text-ovr-text-muted transition-colors hover:bg-ovr-bg-panel hover:text-ovr-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={() => chatSearchStore.next()}
          disabled={matchCount === 0}
          title="Next match (Enter)"
          className="rounded p-0.5 text-ovr-text-muted transition-colors hover:bg-ovr-bg-panel hover:text-ovr-text-primary disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown size={14} />
        </button>
        <button
          onClick={() => chatSearchStore.close()}
          title="Close (Esc)"
          className="rounded p-0.5 text-ovr-text-muted transition-colors hover:bg-ovr-bg-panel hover:text-ovr-text-primary"
        >
          <X size={14} />
        </button>
      </div>
      {revealCapped && (
        <span className="text-[10px] text-ovr-text-muted">Searching visible messages only</span>
      )}
    </div>
  )
})

function counterLabel(query: string, matchCount: number, currentIndex: number): string {
  if (query.trim().length === 0) return ""
  if (matchCount === 0) return "No results"
  return `${currentIndex + 1}/${matchCount}`
}
