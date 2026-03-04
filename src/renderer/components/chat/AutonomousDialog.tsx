import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { useState, useEffect } from "react"
import { Textarea } from "../shared/Textarea"
import { Input } from "../shared/Input"

interface AutonomousDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPrompt: string
  onStart: (prompt: string, maxIterations: number) => void
}

export function AutonomousDialog({
  open,
  onOpenChange,
  initialPrompt,
  onStart,
}: AutonomousDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [maxIterations, setMaxIterations] = useState(25)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt)
      setMaxIterations(25)
    }
  }, [open, initialPrompt])

  const handleStart = () => {
    if (!prompt.trim()) return
    onStart(prompt.trim(), maxIterations)
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
}
