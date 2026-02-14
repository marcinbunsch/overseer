import { observer } from "mobx-react-lite"
import { useState, useRef, useCallback } from "react"
import * as Tabs from "@radix-ui/react-tabs"
import { AlertTriangle, CircleCheck, History, LoaderCircle } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { configStore } from "../../stores/ConfigStore"
import { AGENT_TITLES } from "../../constants/agents"
import { useClickOutside } from "../../hooks/useClickOutside"
import type { AgentType } from "../../types"
import { AgentIcon } from "./AgentIcon"
import { BetaBadge } from "../shared/BetaBadge"
import { ChatHistoryDialog } from "./ChatHistoryDialog"

export const ChatTabs = observer(function ChatTabs() {
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const chats = workspaceStore?.activeChats ?? []
  const activeId = workspaceStore?.activeChatId
  const hasArchivedChats = workspaceStore?.hasArchivedChats ?? false
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [showMenu, setShowMenu] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setShowMenu(false), [])
  useClickOutside(menuRef, showMenu, closeMenu)

  const handleDoubleClick = (chatId: string, currentLabel: string) => {
    setEditingId(chatId)
    setEditValue(currentLabel)
  }

  const handleRenameSubmit = () => {
    if (editingId && editValue.trim()) {
      workspaceStore?.renameChat(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const handleNewChat = (agentType: AgentType) => {
    workspaceStore?.newChat(agentType)
    setShowMenu(false)
  }

  if (!workspaceStore) return null

  return (
    <>
      <Tabs.Root
        value={activeId ?? undefined}
        onValueChange={(value) => workspaceStore.switchChat(value)}
        activationMode="manual"
        className="flex items-center border-b border-ovr-border-subtle bg-ovr-bg-panel"
      >
        <Tabs.List className="flex flex-1 overflow-x-auto" loop>
          {chats.map((cs) => {
            const isActive = cs.chat.id === activeId
            const isEditing = editingId === cs.chat.id

            return (
              <Tabs.Trigger
                key={cs.chat.id}
                value={cs.chat.id}
                onDoubleClick={() => handleDoubleClick(cs.chat.id, cs.chat.label)}
                className={`group flex shrink-0 cursor-pointer items-center border-b-2 py-1.5 text-xs outline-none focus-visible:rounded focus-visible:bg-ovr-azure-500/20 ${
                  isActive
                    ? "border-ovr-azure-500 text-ovr-text-primary"
                    : "border-transparent text-ovr-text-muted hover:text-ovr-text-primary"
                }`}
              >
                {/* Left slot - fixed width for icon/status */}
                <span className="flex w-8 shrink-0 items-center justify-center">
                  {cs.status === "running" ? (
                    <LoaderCircle
                      className={`size-3 text-ovr-azure-500 ${configStore.animationsEnabled ? "animate-spin" : ""}`}
                    />
                  ) : cs.status === "needs_attention" ? (
                    <AlertTriangle className="size-3 text-ovr-warn" />
                  ) : cs.status === "done" ? (
                    <CircleCheck className="size-3 text-ovr-ok" />
                  ) : cs.agentType ? (
                    <span title={AGENT_TITLES[cs.agentType]}>
                      <AgentIcon
                        agentType={cs.agentType}
                        size={12}
                        className="text-ovr-text-muted"
                      />
                    </span>
                  ) : (
                    <span
                      className="inline-block size-3 rounded-full border border-dashed border-ovr-text-dim"
                      title="Select an agent"
                    />
                  )}
                </span>

                {/* Center - label */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleRenameSubmit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSubmit()
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-20 border-b border-ovr-azure-500 bg-transparent text-xs outline-none"
                  />
                ) : (
                  <span className="max-w-30 truncate">{cs.chat.label}</span>
                )}

                {/* Right slot - fixed width for archive button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    workspaceStore.archiveChat(cs.chat.id)
                  }}
                  className="flex w-8 shrink-0 items-center justify-center text-ovr-text-muted opacity-0 transition-opacity hover:text-ovr-text-primary group-hover:opacity-100"
                  title="Archive chat"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="size-3"
                  >
                    <path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5zm13-3H1v2h14zM5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5" />
                  </svg>
                </button>
              </Tabs.Trigger>
            )
          })}
        </Tabs.List>

        {hasArchivedChats && (
          <button
            onClick={() => setShowHistoryDialog(true)}
            className="shrink-0 px-2 py-1.5 text-ovr-text-muted hover:text-ovr-text-primary"
            title="Chat history"
          >
            <History className="size-3.5" />
          </button>
        )}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="shrink-0 px-2 py-1.5 text-sm text-ovr-text-muted hover:text-ovr-text-primary"
            title="New chat"
          >
            +
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-35 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg">
              {configStore.isAgentEnabled("claude") && (
                <button
                  onClick={() => handleNewChat("claude")}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary hover:bg-ovr-bg-panel"
                >
                  <AgentIcon agentType="claude" size={14} showWarning /> New Claude chat
                </button>
              )}
              {configStore.isAgentEnabled("codex") && (
                <button
                  onClick={() => handleNewChat("codex")}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary hover:bg-ovr-bg-panel"
                >
                  <AgentIcon agentType="codex" size={14} showWarning /> New Codex chat
                </button>
              )}
              {configStore.isAgentEnabled("copilot") && (
                <button
                  onClick={() => handleNewChat("copilot")}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary hover:bg-ovr-bg-panel"
                >
                  <AgentIcon agentType="copilot" size={14} showWarning /> New Copilot chat
                  <BetaBadge />
                </button>
              )}
              {configStore.isAgentEnabled("gemini") && (
                <button
                  onClick={() => handleNewChat("gemini")}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary hover:bg-ovr-bg-panel"
                >
                  <AgentIcon agentType="gemini" size={14} showWarning /> New Gemini chat
                  <BetaBadge />
                </button>
              )}
              {configStore.isAgentEnabled("opencode") && (
                <button
                  onClick={() => handleNewChat("opencode")}
                  className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary hover:bg-ovr-bg-panel"
                >
                  <AgentIcon agentType="opencode" size={14} showWarning /> New OpenCode chat
                  <BetaBadge />
                </button>
              )}
              {configStore.enabledAgents.length === 0 && (
                <div className="px-3 py-1.5 text-xs text-ovr-text-dim">No agents enabled</div>
              )}
            </div>
          )}
        </div>
      </Tabs.Root>

      <ChatHistoryDialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog} />
    </>
  )
})
