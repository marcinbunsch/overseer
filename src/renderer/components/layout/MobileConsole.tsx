import { observer } from "mobx-react-lite"
import { useEffect, useRef } from "react"
import { X, Trash2 } from "lucide-react"
import { uiStore } from "../../stores/UIStore"
import { consoleStore, type ConsoleLevel } from "../../stores/ConsoleStore"

function getLevelColor(level: ConsoleLevel): string {
  switch (level) {
    case "error":
      return "text-red-400"
    case "warn":
      return "text-yellow-400"
    case "info":
      return "text-blue-400"
    case "debug":
      return "text-gray-500"
    default:
      return "text-ovr-text"
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Mobile debug console that slides down from the top.
 * Displays captured console.log/warn/error output.
 */
export const MobileConsole = observer(function MobileConsole() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isOpen = uiStore.mobileConsoleOpen

  // Auto-scroll to bottom when new entries arrive
  const entriesLength = consoleStore.entries.length
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isOpen, entriesLength])

  // Mark errors as read when console opens
  useEffect(() => {
    if (isOpen) {
      consoleStore.markRead()
    }
  }, [isOpen])

  return (
    <div
      className={`absolute inset-x-0 top-0 z-30 h-[50vh] transform transition-transform duration-200 ease-in-out md:hidden ${
        isOpen ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="flex h-full flex-col border-b border-ovr-border-subtle bg-ovr-bg-panel">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-ovr-border-subtle px-3 py-2">
          <span className="text-sm font-medium text-ovr-text">Console</span>
          <div className="flex gap-2">
            <button
              onClick={() => consoleStore.clear()}
              className="flex h-7 w-7 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
              aria-label="Clear console"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={() => uiStore.toggleMobileConsole()}
              className="flex h-7 w-7 items-center justify-center rounded text-ovr-text-muted hover:bg-ovr-bg-hover hover:text-ovr-text"
              aria-label="Close console"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
          {consoleStore.entries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
              No console output yet
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {consoleStore.entries.map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <span className="shrink-0 text-ovr-text-muted">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span className={`whitespace-pre-wrap break-all ${getLevelColor(entry.level)}`}>
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
