import { observer } from "mobx-react-lite"
import { useRef, useEffect, useState, useCallback } from "react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { debugStore } from "../../stores/DebugStore"
import { eventBus } from "../../utils/eventBus"
import { ModelSelector } from "./ModelSelector"
import { ClaudePermissionModeSelector } from "./ClaudePermissionModeSelector"
import { AtSearch } from "./AtSearch"
import { getAgentDisplayName } from "../../utils/agentDisplayName"
import { Textarea } from "../shared/Textarea"

interface ChatInputProps {
  onSend: (content: string) => void
  onStop?: () => void
  isSending?: boolean
  agentType?: string
  modelVersion?: string | null
  onModelChange?: (model: string | null) => void
  permissionMode?: string | null
  onPermissionModeChange?: (mode: string | null) => void
  hasMessages?: boolean
  workspacePath: string
}

// Find the @ trigger and query in the input text based on cursor position
function findAtQuery(text: string, cursorPos: number): { start: number; query: string } | null {
  // Look backwards from cursor to find @
  let atPos = -1
  for (let i = cursorPos - 1; i >= 0; i--) {
    const char = text[i]
    // Stop if we hit whitespace before finding @
    if (char === " " || char === "\n" || char === "\t") {
      break
    }
    if (char === "@") {
      atPos = i
      break
    }
  }

  if (atPos === -1) return null

  // @ must be at start of input or preceded by whitespace
  if (
    atPos > 0 &&
    text[atPos - 1] !== " " &&
    text[atPos - 1] !== "\n" &&
    text[atPos - 1] !== "\t"
  ) {
    return null
  }

  // Extract query from @ to cursor
  const query = text.slice(atPos + 1, cursorPos)
  return { start: atPos, query }
}

export const ChatInput = observer(function ChatInput({
  onSend,
  onStop,
  isSending,
  agentType = "claude",
  modelVersion,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  hasMessages,
  workspacePath,
}: ChatInputProps) {
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const input = workspaceStore?.currentDraft ?? ""
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [atSearch, setAtSearch] = useState<{ start: number; query: string } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const activeChatId = workspaceStore?.activeChatId
  useEffect(() => {
    if (!activeChatId) return

    textareaRef.current?.focus()
  }, [activeChatId])

  // Listen for keyboard shortcut to focus chat input
  useEffect(() => {
    return eventBus.on("overseer:focus_chat_input", () => {
      textareaRef.current?.focus()
    })
  }, [])

  const setInput = useCallback(
    (text: string) => {
      const chatId = workspaceStore?.activeChatId
      if (chatId) workspaceStore?.setDraft(chatId, text)
    },
    [workspaceStore]
  )

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onSend(trimmed)
  }

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart
      setInput(newValue)

      // Check for @ trigger
      const atQuery = findAtQuery(newValue, cursorPos)
      if (atQuery) {
        setAtSearch(atQuery)
        setSelectedIndex(0)
      } else {
        setAtSearch(null)
      }
    },
    [setInput]
  )

  const handleSelect = useCallback(
    (path: string) => {
      if (!atSearch) return

      const el = textareaRef.current
      const cursorPos = el?.selectionStart ?? input.length

      // Replace @query with the path
      const before = input.slice(0, atSearch.start)
      const after = input.slice(cursorPos)
      const newValue = before + path + after

      setInput(newValue)
      setAtSearch(null)

      // Set cursor position after the inserted path
      requestAnimationFrame(() => {
        if (el) {
          const newPos = atSearch.start + path.length
          el.focus()
          el.setSelectionRange(newPos, newPos)
        }
      })
    },
    [atSearch, input, setInput]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (atSearch) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => i + 1)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        // The AtSearch component will handle the selection via onSelect
        // We need to trigger selection of current item
        const event = new CustomEvent("at-search-select")
        document.dispatchEvent(event)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setAtSearch(null)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        const event = new CustomEvent("at-search-select")
        document.dispatchEvent(event)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-ovr-border-subtle p-3">
      <div className="relative flex flex-col gap-2">
        {atSearch && (
          <AtSearch
            query={atSearch.query}
            workspacePath={workspacePath}
            onSelect={handleSelect}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={setSelectedIndex}
          />
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isSending
              ? "Type a follow-up message to queue..."
              : `Ask ${getAgentDisplayName(agentType)}... (Enter to send, Shift+Enter for newline, @ to search files)`
          }
          rows={1}
          className={`min-h-20 resize-none text-sm placeholder:text-ovr-text-muted disabled:opacity-50 ${
            debugStore.showDevUI
              ? "border-ovr-dev focus:border-ovr-dev"
              : "focus:border-ovr-azure-500"
          }`}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onModelChange && (
              <ModelSelector
                value={modelVersion ?? null}
                onChange={onModelChange}
                disabled={isSending || hasMessages}
                agentType={agentType}
              />
            )}
            {agentType === "claude" && onPermissionModeChange && (
              <ClaudePermissionModeSelector
                value={permissionMode ?? null}
                onChange={onPermissionModeChange}
                disabled={isSending || hasMessages}
              />
            )}
          </div>
          <div className="flex gap-2">
            {isSending && onStop && (
              <button
                onClick={onStop}
                className="rounded-lg bg-ovr-bad px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Stop
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="rounded-lg bg-ovr-azure-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSending ? "Queue" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
