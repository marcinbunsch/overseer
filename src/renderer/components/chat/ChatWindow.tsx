import { observer } from "mobx-react-lite"
import { useEffect, useState, useRef, useCallback } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { CodeXml, TerminalSquare, Bug, Copy, Hash, FileText } from "lucide-react"
import type { Workspace } from "../../types"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { terminalStore } from "../../stores/TerminalStore"
import { debugStore } from "../../stores/DebugStore"
import { externalService } from "../../services/external"
import { toastStore } from "../../stores/ToastStore"
import { isDefaultBranch } from "../../utils/git"
import { MessageList } from "./MessageList"
import { ChatInput } from "./ChatInput"
import { ToolApprovalPanel } from "./ToolApprovalPanel"
import { PlanApprovalPanel } from "./PlanApprovalPanel"
import { PlanReviewDialog } from "./PlanReviewDialog"
import { AgentQuestionPanel } from "./AgentQuestionPanel"
import { ChatTabs } from "./ChatTabs"
import { NewChatScreen } from "./NewChatScreen"
import { QueuedMessagesPanel } from "./QueuedMessagesPanel"

interface ChatWindowProps {
  workspace: Workspace
}

export const ChatWindow = observer(function ChatWindow({ workspace }: ChatWindowProps) {
  const workspaceStore = projectRegistry.selectedWorkspaceStore

  useEffect(() => {
    workspaceStore?.load()
    terminalStore.openTerminal(workspace.path)

    return () => {
      terminalStore.closeTerminal()
    }
  }, [workspace.id, workspace.path, workspaceStore])

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(workspace.branch)
  const [planReviewOpen, setPlanReviewOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCopyChatId = useCallback(() => {
    if (workspaceStore?.activeChatId) {
      navigator.clipboard.writeText(workspaceStore.activeChatId)
      toastStore.show("Copied chat ID")
    }
  }, [workspaceStore])

  const handleCopyChatLogPath = useCallback(async () => {
    if (workspaceStore?.activeChatId) {
      const path = await workspaceStore.getChatLogPath(workspaceStore.activeChatId)
      if (path) {
        navigator.clipboard.writeText(path)
        toastStore.show("Copied chat log path")
      }
    }
  }, [workspaceStore])

  const commitRename = useCallback(async () => {
    const success = await projectRegistry.renameBranchSafe(
      workspace.id,
      editValue,
      workspace.branch
    )
    if (!success) setEditValue(workspace.branch)
    setEditing(false)
  }, [editValue, workspace.id, workspace.branch])

  const handleSubmitReview = useCallback(
    (feedback: string) => {
      workspaceStore?.rejectPlan(feedback)
      setPlanReviewOpen(false)
    },
    [workspaceStore]
  )

  const handleApprovePlan = useCallback(() => {
    workspaceStore?.approvePlan()
    setPlanReviewOpen(false)
  }, [workspaceStore])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  if (!workspaceStore) {
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="flex items-center border-b border-ovr-border-subtle px-4 py-2"
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur()
              } else if (e.key === "Escape") {
                setEditValue(workspace.branch)
                setEditing(false)
              }
            }}
            className="rounded border border-ovr-border-subtle bg-ovr-bg-elevated px-1 text-sm font-medium text-ovr-text-primary outline-none focus:border-ovr-accent"
            spellCheck={false}
          />
        ) : isDefaultBranch(workspace.branch) ? (
          <span className="rounded px-1 text-sm font-medium text-ovr-text-primary">
            {workspace.branch}
          </span>
        ) : (
          <span
            className="cursor-pointer rounded px-1 text-sm font-medium text-ovr-text-primary hover:bg-ovr-bg-elevated"
            onClick={() => {
              setEditValue(workspace.branch)
              setEditing(true)
            }}
            title="Click to rename branch"
          >
            {workspace.branch}
          </span>
        )}
        <span className="ml-2 text-xs text-ovr-text-muted">{workspace.path}</span>
        <div className="ml-auto flex gap-1">
          {debugStore.isDebugMode && workspaceStore.activeChatId && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="rounded border border-ovr-border-subtle p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
                  title="Debug options"
                >
                  <Bug size={16} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-40 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenu.Item
                    onSelect={handleCopyChatId}
                    className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                  >
                    <Hash size={14} /> Copy chat ID
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={handleCopyChatLogPath}
                    className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                  >
                    <FileText size={14} /> Copy chat log path
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <button
            onClick={() => {
              externalService.openInEditor(workspace.path)
              toastStore.show("Opened in editor")
            }}
            className="rounded border border-ovr-border-subtle p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
            title="Open in editor"
          >
            <CodeXml size={16} />
          </button>
          <button
            onClick={() => {
              externalService.openInTerminal(workspace.path)
              toastStore.show("Opened in terminal")
            }}
            className="rounded border border-ovr-border-subtle p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
            title="Open in terminal"
          >
            <TerminalSquare size={16} />
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(workspace.path)
              toastStore.show("Copied workspace path")
            }}
            className="rounded border border-ovr-border-subtle p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
            title="Copy workspace path"
          >
            <Copy size={16} />
          </button>
        </div>
      </div>

      {workspaceStore.loading ? null : workspaceStore.activeChats.length === 0 ? (
        <NewChatScreen />
      ) : (
        <>
          <ChatTabs />

          {/* Show NewChatScreen if active chat has no agent selected yet */}
          {!workspaceStore.activeChat?.agentType ? (
            <NewChatScreen isPendingChat />
          ) : (
            <>
              <MessageList key={workspaceStore.activeChatId} turns={workspaceStore.currentTurns} />

              <QueuedMessagesPanel
                messages={workspaceStore.pendingFollowUps}
                onRemove={(index) => workspaceStore.removeFollowUp(index)}
              />

              <ToolApprovalPanel
                pendingTools={workspaceStore.pendingToolUses}
                onApprove={(toolId) => workspaceStore.approveToolUse(toolId, true)}
                onApproveAll={(toolId, scope) => workspaceStore.approveToolUseAll(toolId, scope)}
                onDeny={(toolId) => workspaceStore.approveToolUse(toolId, false)}
              />

              <PlanApprovalPanel
                pending={workspaceStore.pendingPlanApproval}
                onApprove={() => workspaceStore.approvePlan()}
                onReject={(feedback) => workspaceStore.rejectPlan(feedback)}
                onDeny={() => workspaceStore.denyPlan()}
                onReview={() => setPlanReviewOpen(true)}
              />

              {workspaceStore.pendingPlanApproval && (
                <PlanReviewDialog
                  open={planReviewOpen}
                  onOpenChange={setPlanReviewOpen}
                  planContent={workspaceStore.pendingPlanApproval.planContent}
                  onSubmitReview={handleSubmitReview}
                  onApprove={handleApprovePlan}
                />
              )}

              <AgentQuestionPanel
                pendingQuestions={workspaceStore.pendingQuestions}
                onAnswer={(toolUseId, answers) => workspaceStore.answerQuestion(toolUseId, answers)}
              />

              <ChatInput
                onSend={(content) => workspaceStore.sendMessage(content)}
                onStop={() => workspaceStore.stopGeneration()}
                isSending={workspaceStore.isSending}
                agentType={workspaceStore.activeChat?.agentType}
                modelVersion={workspaceStore.activeChat?.modelVersion ?? null}
                onModelChange={(model) => workspaceStore.setModelVersion(model)}
                permissionMode={workspaceStore.activeChat?.permissionMode ?? null}
                onPermissionModeChange={(mode) => workspaceStore.setPermissionMode(mode)}
                hasMessages={(workspaceStore.activeChat?.messages.length ?? 0) > 0}
                workspacePath={workspace.path}
              />
            </>
          )}
        </>
      )}
    </div>
  )
})
