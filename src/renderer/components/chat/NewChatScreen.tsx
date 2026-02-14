import { observer } from "mobx-react-lite"
import { useState } from "react"
import { History } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { configStore } from "../../stores/ConfigStore"
import { toolAvailabilityStore } from "../../stores/ToolAvailabilityStore"
import type { AgentType } from "../../types"
import { ClaudeIcon, OpenAIIcon, GitHubCopilotIcon, GeminiIcon, OpenCodeIcon } from "./AgentIcon"
import { BetaBadge } from "../shared/BetaBadge"
import { ChatHistoryDialog } from "./ChatHistoryDialog"

interface AgentButtonProps {
  agentType: AgentType
  title: string
  description: string
  icon: React.ReactNode
  onClick: () => void
  unavailable?: boolean
  unavailableMessage?: string
  beta?: boolean
}

function AgentButton({
  title,
  description,
  icon,
  onClick,
  unavailable,
  unavailableMessage,
  beta,
}: AgentButtonProps) {
  return (
    <button
      onClick={onClick}
      className="group flex w-40 flex-col items-center gap-4 rounded-xl border border-ovr-border-subtle bg-ovr-bg-elevated p-6 transition-all hover:border-ovr-accent hover:bg-ovr-bg-panel"
    >
      <div className="relative">
        <div className="text-ovr-text-muted transition-colors group-hover:text-ovr-text-primary">
          {icon}
        </div>
        {unavailable && (
          <div
            className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-ovr-warn text-ovr-bg-base"
            title={unavailableMessage}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3">
              <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
            </svg>
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 text-lg font-medium text-ovr-text-primary">
          {title}
          {beta && <BetaBadge className="px-1.5" />}
        </div>
        <div className="mt-1 text-sm text-ovr-text-muted">{description}</div>
      </div>
    </button>
  )
}

interface NewChatScreenProps {
  /** If true, this is shown for a pending chat tab that needs an agent selection */
  isPendingChat?: boolean
}

export const NewChatScreen = observer(function NewChatScreen({
  isPendingChat = false,
}: NewChatScreenProps) {
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const claudeStatus = toolAvailabilityStore.claude
  const codexStatus = toolAvailabilityStore.codex
  const copilotStatus = toolAvailabilityStore.copilot
  const geminiStatus = toolAvailabilityStore.gemini
  const opencodeStatus = toolAvailabilityStore.opencode
  const hasArchivedChats = workspaceStore?.hasArchivedChats ?? false
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)

  const handleSelectAgent = (agentType: AgentType) => {
    if (isPendingChat) {
      // Set the agent for the existing pending chat
      workspaceStore?.setActiveChatAgent(agentType)
    } else {
      // Create a new chat with this agent
      workspaceStore?.newChat(agentType)
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <h2 className="mb-2 text-xl font-medium text-ovr-text-primary">
        {isPendingChat ? "Select an agent" : "Start a new chat"}
      </h2>
      <p className="mb-8 text-sm text-ovr-text-muted">Choose an AI agent to get started</p>

      <div className="flex flex-wrap justify-center gap-4">
        {configStore.isAgentEnabled("claude") && (
          <AgentButton
            agentType="claude"
            title="Claude"
            description="Anthropic's AI assistant"
            icon={<ClaudeIcon size={48} />}
            onClick={() => handleSelectAgent("claude")}
            unavailable={claudeStatus !== null && !claudeStatus.available}
            unavailableMessage={claudeStatus?.error}
          />
        )}
        {configStore.isAgentEnabled("codex") && (
          <AgentButton
            agentType="codex"
            title="Codex"
            description="OpenAI's coding agent"
            icon={<OpenAIIcon size={48} />}
            onClick={() => handleSelectAgent("codex")}
            unavailable={codexStatus !== null && !codexStatus.available}
            unavailableMessage={codexStatus?.error}
          />
        )}
        {configStore.isAgentEnabled("copilot") && (
          <AgentButton
            agentType="copilot"
            title="Copilot"
            description="GitHub's AI pair programmer"
            icon={<GitHubCopilotIcon size={48} />}
            onClick={() => handleSelectAgent("copilot")}
            unavailable={copilotStatus !== null && !copilotStatus.available}
            unavailableMessage={copilotStatus?.error}
            beta
          />
        )}
        {configStore.isAgentEnabled("gemini") && (
          <AgentButton
            agentType="gemini"
            title="Gemini"
            description="Google's AI model"
            icon={<GeminiIcon size={48} />}
            onClick={() => handleSelectAgent("gemini")}
            unavailable={geminiStatus !== null && !geminiStatus.available}
            unavailableMessage={geminiStatus?.error}
            beta
          />
        )}
        {configStore.isAgentEnabled("opencode") && (
          <AgentButton
            agentType="opencode"
            title="OpenCode"
            description="Open-source coding agent"
            icon={<OpenCodeIcon size={48} />}
            onClick={() => handleSelectAgent("opencode")}
            unavailable={opencodeStatus !== null && !opencodeStatus.available}
            unavailableMessage={opencodeStatus?.error}
            beta
          />
        )}
      </div>
      {configStore.enabledAgents.length === 0 && (
        <p className="mt-8 text-sm text-ovr-text-dim">
          No agents enabled. Enable agents in Settings.
        </p>
      )}

      {hasArchivedChats && (
        <button
          onClick={() => setShowHistoryDialog(true)}
          className="mt-8 flex items-center gap-1.5 text-sm text-ovr-text-muted hover:text-ovr-text-primary"
        >
          <History className="size-4" />
          Open archived chat
        </button>
      )}

      <ChatHistoryDialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog} />
    </div>
  )
})
