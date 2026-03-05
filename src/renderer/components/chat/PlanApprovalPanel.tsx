import { useState } from "react"
import { observer } from "mobx-react-lite"
import type { PendingPlanApproval, AutonomousReviewConfig } from "../../types"
import { configStore } from "../../stores/ConfigStore"
import { MarkdownContent } from "./MarkdownContent"
import { Textarea } from "../shared/Textarea"
import { AutonomousDialog } from "./AutonomousDialog"

interface PlanApprovalPanelProps {
  pending: PendingPlanApproval | null
  onApprove: () => void
  onReject: (feedback: string) => void
  onDeny: () => void
  onReview: () => void
  onStartAutonomous?: (
    prompt: string,
    maxIterations: number,
    reviewConfig?: AutonomousReviewConfig
  ) => void
}

export const PlanApprovalPanel = observer(function PlanApprovalPanel({
  pending,
  onApprove,
  onReject,
  onDeny,
  onReview,
  onStartAutonomous,
}: PlanApprovalPanelProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [autonomousDialogOpen, setAutonomousDialogOpen] = useState(false)

  if (!pending) return null

  return (
    <div className="border-t border-ovr-border-subtle bg-ovr-bg-panel px-4 py-3">
      <div className="mb-2 last:mb-0 rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
        <div className="mb-1 text-sm font-medium text-ovr-text-primary">
          Claude has proposed a plan
        </div>

        {pending.planContent && (
          <div className="mb-3 max-h-96 overflow-y-auto rounded border border-ovr-border-subtle bg-ovr-bg-panel p-3 text-sm text-ovr-text-primary">
            <MarkdownContent content={pending.planContent} />
          </div>
        )}

        {!pending.planContent && (
          <div className="mb-3 text-xs text-ovr-text-muted">
            Review the plan above, then approve or request changes.
          </div>
        )}

        {showFeedback ? (
          <div>
            <Textarea
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey && feedback.trim()) {
                  onReject(feedback)
                  setShowFeedback(false)
                  setFeedback("")
                }
              }}
              placeholder="Describe the changes you'd like..."
              rows={3}
              className="mb-2 resize-none rounded px-2 py-1.5 text-xs"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onReject(feedback)
                  setShowFeedback(false)
                  setFeedback("")
                }}
                disabled={!feedback.trim()}
                className="rounded-lg bg-ovr-azure-500 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Send Feedback
              </button>
              <button
                onClick={() => {
                  setShowFeedback(false)
                  setFeedback("")
                }}
                className="ovr-btn-ghost px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={onApprove}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Approve
            </button>
            {configStore.autonomousModeEnabled && onStartAutonomous && (
              <button
                onClick={() => setAutonomousDialogOpen(true)}
                className="rounded-lg bg-ovr-azure-500 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                data-testid="plan-autonomous-run-button"
              >
                Autonomous Run
              </button>
            )}
            <button onClick={onReview} className="ovr-btn-ghost px-3 py-1.5 text-sm">
              Review
            </button>
            <button
              onClick={() => setShowFeedback(true)}
              className="ovr-btn-ghost px-3 py-1.5 text-sm"
            >
              Request Changes
            </button>
            <button onClick={onDeny} className="ovr-btn-danger px-3 py-1.5 text-sm">
              Deny
            </button>
          </div>
        )}
      </div>

      {configStore.autonomousModeEnabled && onStartAutonomous && (
        <AutonomousDialog
          open={autonomousDialogOpen}
          onOpenChange={setAutonomousDialogOpen}
          initialPrompt={`Execute the following plan:\n\n${pending.planContent ?? ""}`}
          onStart={(prompt, maxIterations, reviewConfig) => {
            onStartAutonomous(prompt, maxIterations, reviewConfig)
            onDeny() // Close the plan approval after starting autonomous run
          }}
        />
      )}
    </div>
  )
})
