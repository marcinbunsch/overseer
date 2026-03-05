import * as AlertDialog from "@radix-ui/react-alert-dialog"
import * as Select from "@radix-ui/react-select"
import { useState, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import { observer } from "mobx-react-lite"
import { Textarea } from "../shared/Textarea"
import { Input } from "../shared/Input"
import { Checkbox } from "../shared/Checkbox"
import { ModelSelector } from "./ModelSelector"
import { configStore } from "../../stores/ConfigStore"
import { getAgentDisplayName } from "../../utils/agentDisplayName"
import type { AgentType, AutonomousReviewConfig } from "../../types"

interface AutonomousDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPrompt: string
  onStart: (prompt: string, maxIterations: number, reviewConfig?: AutonomousReviewConfig) => void
}

export const AutonomousDialog = observer(function AutonomousDialog({
  open,
  onOpenChange,
  initialPrompt,
  onStart,
}: AutonomousDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [maxIterations, setMaxIterations] = useState(25)
  const [useReviewAgent, setUseReviewAgent] = useState(false)
  const [reviewAgentType, setReviewAgentType] = useState<AgentType>("claude")
  const [reviewModelVersion, setReviewModelVersion] = useState<string | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      setMaxIterations(25)
      setUseReviewAgent(false)
      setReviewAgentType("claude")
      setReviewModelVersion(null)
    }
  }, [open, initialPrompt])

  // Reset model when agent type changes
  useEffect(() => {
    setReviewModelVersion(null)
  }, [reviewAgentType])

  const handleStart = () => {
    if (!prompt.trim()) return
    const reviewConfig: AutonomousReviewConfig | undefined = useReviewAgent
      ? { agentType: reviewAgentType, modelVersion: reviewModelVersion }
      : undefined
    onStart(prompt.trim(), maxIterations, reviewConfig)
    onOpenChange(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault()
      handleStart()
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel"
          onKeyDown={handleKeyDown}
        >
          <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
            Start Autonomous Run
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-ovr-text-muted">
            The agent will run in a loop, reading its progress from files and working toward your
            goal. Each iteration starts with fresh context.
          </AlertDialog.Description>

          <div className="mt-4 flex flex-1 flex-col gap-4 overflow-hidden">
            <div className="flex flex-1 flex-col gap-1 overflow-hidden">
              <label className="text-xs font-medium text-ovr-text-secondary">Goal / Prompt</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the task you want the agent to complete..."
                className="min-h-64 flex-1 resize-y"
                data-testid="autonomous-prompt-input"
                autoFocus
              />
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-ovr-text-secondary">
                  Max iterations
                </label>
                <Input
                  type="number"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={100}
                  className="w-20"
                  data-testid="autonomous-max-iterations-input"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-ovr-text-muted">
                <span className="rounded bg-ovr-bg-elevated px-2 py-1 text-ovr-warning">
                  YOLO mode enabled
                </span>
                <span>All tool requests auto-approved</span>
              </div>
            </div>

            {/* Review agent configuration */}
            <div className="flex flex-col gap-3 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={useReviewAgent}
                  onChange={(e) => setUseReviewAgent(e.target.checked)}
                  data-testid="autonomous-use-review-agent-checkbox"
                />
                <span className="text-xs font-medium text-ovr-text-secondary">
                  Use a different model for review steps
                </span>
              </label>

              {useReviewAgent && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-ovr-text-muted">Agent</label>
                  <Select.Root
                    value={reviewAgentType}
                    onValueChange={(v) => setReviewAgentType(v as AgentType)}
                  >
                    <Select.Trigger
                      className="flex items-center gap-1.5 rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-xs text-ovr-text-primary outline-none"
                      data-testid="autonomous-review-agent-select"
                    >
                      <Select.Value />
                      <ChevronDown size={12} className="text-ovr-text-muted" />
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="z-[200] rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg">
                        <Select.Viewport className="p-1">
                          {configStore.enabledAgents.map((agent) => (
                            <Select.Item
                              key={agent}
                              value={agent}
                              className="cursor-pointer rounded px-2 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                            >
                              <Select.ItemText>{getAgentDisplayName(agent)}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>

                  <label className="text-xs text-ovr-text-muted">Model</label>
                  <ModelSelector
                    value={reviewModelVersion}
                    onChange={setReviewModelVersion}
                    agentType={reviewAgentType}
                    data-testid="autonomous-review-model-select"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Cancel</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="ovr-btn-primary cursor-pointer px-4 py-1.5 text-xs"
                onClick={handleStart}
                disabled={!prompt.trim()}
                data-testid="autonomous-start-button"
              >
                Start Autonomous Run
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
