import { useState } from "react"
import { observer } from "mobx-react-lite"
import type { Message, AutonomousMessageType, AutonomousReviewConfig } from "../../types"
import {
  Play,
  RotateCw,
  CheckCircle,
  StopCircle,
  ChevronRight,
  ChevronDown,
  Shield,
} from "lucide-react"
import classNames from "classnames"
import { MarkdownContent } from "./MarkdownContent"
import { projectRegistry } from "../../stores/ProjectRegistry"

interface AutonomousMessageProps {
  message: Message
}

export const AutonomousMessage = observer(function AutonomousMessage({
  message,
}: AutonomousMessageProps) {
  const [expanded, setExpanded] = useState(false)
  const autonomousType = message.meta?.autonomousType as AutonomousMessageType | undefined
  if (!autonomousType) return null

  const { icon, bgClass, borderClass } = getAutonomousStyle(autonomousType)

  // For loop messages, show a collapsed header with expandable prompt
  const isLoopMessage = autonomousType === "autonomous-loop"
  const iteration = message.meta?.iteration
  const maxIterations = message.meta?.maxIterations

  // Generate the header text for loop messages
  const phase = message.meta?.phase
  const reviewAgentLabel = message.meta?.reviewAgentLabel
  const phaseLabel =
    phase === "review" ? (reviewAgentLabel ? ` (Review via ${reviewAgentLabel})` : " (Review)") : ""
  const headerText = isLoopMessage
    ? `🔄 **Iteration ${iteration} of ${maxIterations}${phaseLabel}**`
    : message.content

  // For loop messages, the content is the prompt that should be expandable
  const promptContent = isLoopMessage ? message.content : null

  // Show a Continue button only on completions that stopped because they hit the cap.
  const showContinueButton =
    autonomousType === "autonomous-complete" && message.meta?.maxIterationsReached === true
  // Disable while a run is already active for the current chat, to avoid a double-start.
  const runInProgress =
    projectRegistry.selectedWorkspaceStore?.activeChat?.autonomousRunning ?? false

  const onContinue = () => {
    const meta = message.meta
    if (!meta?.maxIterations) return
    const reviewConfig: AutonomousReviewConfig | undefined = meta.reviewAgentType
      ? { agentType: meta.reviewAgentType, modelVersion: meta.reviewModelVersion ?? null }
      : undefined
    void projectRegistry.selectedWorkspaceStore?.continueAutonomousRun(
      meta.maxIterations,
      reviewConfig,
      meta.gauntletReviewers
    )
  }

  return (
    <div
      className={classNames("my-2 rounded-lg border", bgClass, borderClass)}
      data-testid={`autonomous-message-${autonomousType}`}
    >
      {isLoopMessage ? (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2"
          >
            {expanded ? (
              <ChevronDown size={14} className="text-ovr-text-muted" />
            ) : (
              <ChevronRight size={14} className="text-ovr-text-muted" />
            )}
            {icon}
            <span className="text-xs font-medium text-ovr-text-secondary">
              <MarkdownContent content={headerText} className="inline" />
            </span>
          </button>
          {expanded && promptContent && (
            <div className="border-t border-ovr-border-subtle px-3 py-2">
              <MarkdownContent content={promptContent} className="text-xs text-ovr-text-muted" />
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          {icon}
          <span className="text-xs font-medium text-ovr-text-secondary">
            <MarkdownContent content={message.content} className="inline" />
          </span>
          {showContinueButton && (
            <button
              onClick={onContinue}
              disabled={runInProgress}
              className="ovr-btn-ghost ml-auto flex items-center gap-1 px-2 py-1 text-xs"
              data-testid="autonomous-continue-button"
            >
              <Play size={12} />
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  )
})

function getAutonomousStyle(type: AutonomousMessageType): {
  icon: React.ReactNode
  bgClass: string
  borderClass: string
} {
  switch (type) {
    case "autonomous-start":
      return {
        icon: <Play size={14} className="text-ovr-azure-400" />,
        bgClass: "bg-ovr-azure-500/10",
        borderClass: "border-ovr-azure-500/30",
      }
    case "autonomous-loop":
      return {
        icon: <RotateCw size={14} className="text-ovr-text-muted" />,
        bgClass: "bg-ovr-bg-elevated",
        borderClass: "border-ovr-border-subtle",
      }
    case "autonomous-complete":
      return {
        icon: <CheckCircle size={14} className="text-ovr-good" />,
        bgClass: "bg-ovr-good/10",
        borderClass: "border-ovr-good/30",
      }
    case "autonomous-stopped":
      return {
        icon: <StopCircle size={14} className="text-ovr-warning" />,
        bgClass: "bg-ovr-warning/10",
        borderClass: "border-ovr-warning/30",
      }
    case "gauntlet-round":
      return {
        icon: <Shield size={14} className="text-ovr-azure-400" />,
        bgClass: "bg-ovr-azure-500/10",
        borderClass: "border-ovr-azure-500/30",
      }
    case "gauntlet-verdict":
      return {
        icon: <Shield size={14} className="text-ovr-text-muted" />,
        bgClass: "bg-ovr-bg-elevated",
        borderClass: "border-ovr-border-subtle",
      }
  }
}

/**
 * Checks if a message is an autonomous system message that should be rendered specially
 */
export function isAutonomousMessage(message: Message): boolean {
  return message.meta?.autonomousType !== undefined
}
