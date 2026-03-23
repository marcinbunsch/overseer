import { observer } from "mobx-react-lite"
import { useRef, useEffect, useState, useCallback } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { ChevronDown, Play, StopCircle, RotateCw, Paperclip } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { configStore } from "../../stores/ConfigStore"
import { debugStore } from "../../stores/DebugStore"
import { eventBus } from "../../utils/eventBus"
import { ModelSelector } from "./ModelSelector"
import { ClaudePermissionModeSelector } from "./ClaudePermissionModeSelector"
import { ClaudeUsageIndicator } from "./ClaudeUsageIndicator"
import { WebSocketConnectionIndicator } from "./WebSocketConnectionIndicator"
import { AtSearch } from "./AtSearch"
import { AutonomousDialog } from "./AutonomousDialog"
import { AttachmentChip } from "./AttachmentChip"
import { getAgentDisplayName } from "../../utils/agentDisplayName"
import { Textarea } from "../shared/Textarea"
import { saveAttachment } from "../../services/attachmentService"
import type { Attachment, AutonomousReviewConfig } from "../../types"

// Detect touch-only devices (mobile/tablet without keyboard)
const isTouchDevice =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
  !window.matchMedia("(pointer: fine)").matches

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void
  onStop?: () => void
  isSending?: boolean
  agentType?: string
  modelVersion?: string | null
  onModelChange?: (model: string | null) => void
  permissionMode?: string | null
  onPermissionModeChange?: (mode: string | null) => void
  workspacePath: string
  /** External attachments to add (e.g. from Tauri drag-drop on parent container) */
  externalAttachments?: Attachment[] | null
  // Autonomous mode
  autonomousRunning?: boolean
  autonomousIteration?: number
  autonomousMaxIterations?: number
  onStartAutonomous?: (
    prompt: string,
    maxIterations: number,
    reviewConfig?: AutonomousReviewConfig
  ) => void
  onStopAutonomous?: () => void
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
  workspacePath,
  externalAttachments,
  autonomousRunning,
  autonomousIteration,
  autonomousMaxIterations,
  onStartAutonomous,
  onStopAutonomous,
}: ChatInputProps) {
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const input = workspaceStore?.currentDraft ?? ""
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [atSearch, setAtSearch] = useState<{ start: number; query: string } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [autonomousDialogOpen, setAutonomousDialogOpen] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])

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
    if (!trimmed && pendingAttachments.length === 0) return
    onSend(trimmed, pendingAttachments.length > 0 ? pendingAttachments : undefined)
    setPendingAttachments([])
  }

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    for (const file of fileArray) {
      try {
        const attachment = await saveAttachment(file)
        setPendingAttachments((prev) => [...prev, attachment])
      } catch (err) {
        console.error("Failed to save attachment:", err)
      }
    }
  }, [])

  useEffect(() => {
    if (externalAttachments && externalAttachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...externalAttachments])
    }
  }, [externalAttachments])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void processFiles(e.target.files)
        // Reset the input so the same file can be re-attached
        e.target.value = ""
      }
    },
    [processFiles]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (e.clipboardData.files.length > 0) {
        e.preventDefault()
        void processFiles(e.clipboardData.files)
      }
    },
    [processFiles]
  )

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

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

    // On desktop: Enter sends, Shift+Enter adds newline
    // On mobile/touch: Enter adds newline (use Send button to send)
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // If autonomous mode is running, show the control area instead of normal input
  if (autonomousRunning && onStopAutonomous) {
    return (
      <div className="border-t border-ovr-border-subtle p-3">
        <div className="flex items-center justify-between rounded-lg border border-ovr-azure-500/30 bg-ovr-azure-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <RotateCw size={18} className="animate-spin text-ovr-azure-400" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ovr-text-primary">
                Autonomous Mode Running
              </span>
              <span className="text-xs text-ovr-text-muted">
                Iteration {autonomousIteration} of {autonomousMaxIterations}
              </span>
            </div>
          </div>
          <button
            onClick={onStopAutonomous}
            className="flex items-center gap-2 rounded-lg bg-ovr-bad px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            data-testid="autonomous-stop-button"
          >
            <StopCircle size={16} />
            Stop
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-ovr-border-subtle p-3">
      {/* Hidden file input for the paperclip button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="file-input"
      />
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
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="pending-attachments">
            {pendingAttachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            isSending
              ? "Type a follow-up message to queue..."
              : isTouchDevice
                ? `Ask ${getAgentDisplayName(agentType)}...`
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
                disabled={autonomousRunning}
                agentType={agentType}
              />
            )}
            {agentType === "claude" && onPermissionModeChange && (
              <ClaudePermissionModeSelector
                value={permissionMode ?? null}
                onChange={onPermissionModeChange}
                disabled={autonomousRunning}
              />
            )}
            {agentType === "claude" && <ClaudeUsageIndicator />}
            <WebSocketConnectionIndicator />
          </div>
          <div className="flex gap-2">
            {/* Attach file button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg p-2 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
              title="Attach file"
              data-testid="attach-button"
            >
              <Paperclip size={16} />
            </button>
            {isSending && onStop && (
              <button
                onClick={onStop}
                className="rounded-lg bg-ovr-bad px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Stop
              </button>
            )}
            {/* Split button: Send + Autonomous dropdown */}
            <div className="flex">
              <button
                onClick={handleSubmit}
                disabled={!input.trim() && pendingAttachments.length === 0}
                className="rounded-l-lg bg-ovr-azure-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                data-testid="send-button"
              >
                {isSending ? "Queue" : "Send"}
              </button>
              {configStore.autonomousModeEnabled && onStartAutonomous && !isSending && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      className="rounded-r-lg border-l border-ovr-azure-600 bg-ovr-azure-500 px-2 py-2 text-white transition-opacity hover:opacity-90"
                      data-testid="send-dropdown-trigger"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="z-50 min-w-48 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg"
                      align="end"
                      sideOffset={4}
                    >
                      <DropdownMenu.Item
                        onSelect={() => setAutonomousDialogOpen(true)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                        data-testid="autonomous-run-menu-item"
                      >
                        <Play size={14} className="text-ovr-azure-400" />
                        Autonomous Run
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Autonomous mode dialog */}
      {configStore.autonomousModeEnabled && onStartAutonomous && (
        <AutonomousDialog
          open={autonomousDialogOpen}
          onOpenChange={setAutonomousDialogOpen}
          initialPrompt={input}
          onStart={(prompt, maxIterations, reviewConfig) => {
            onStartAutonomous(prompt, maxIterations, reviewConfig)
            workspaceStore?.setDraft(workspaceStore.activeChatId ?? "", "")
          }}
        />
      )}
    </div>
  )
})
