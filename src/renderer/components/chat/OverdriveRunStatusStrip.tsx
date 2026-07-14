import { useState } from "react"
import { observer } from "mobx-react-lite"
import { Check, CircleDot } from "lucide-react"
import { overdriveRunStore } from "../../stores/OverdriveRunStore"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { RunReviewDialog } from "../overdrive/RunReviewDialog"

/**
 * A strip shown above the chat when the selected workspace is an Overdrive run:
 * the run status, a verification summary, Details (full evidence), and
 * Approve/Reject. Renders nothing for normal workspaces.
 */
export const OverdriveRunStatusStrip = observer(function OverdriveRunStatusStrip({
  workspacePath,
}: {
  workspacePath: string
}) {
  const run = overdriveRunStore.runForWorkspace(workspacePath)
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (!run) return null

  const canApprove = run.status === "needsReview"
  const canReject = ["needsReview", "needsInput", "failed"].includes(run.status)
  const verified = run.verification?.finalCheck?.passed === true

  const handleReject = async () => {
    await overdriveRunStore.reject(run.id)
    // The worktree is gone — refresh the tree and leave the workspace.
    await projectRegistry.reload()
    projectRegistry.selectProject(run.repoId)
  }

  return (
    <div
      data-testid="overdrive-run-strip"
      className="flex items-center gap-2 border-b border-ovr-border-subtle bg-ovr-bg-elevated/40 px-3 py-1.5 text-xs"
    >
      <span className="font-medium text-ovr-text-primary">Overdrive</span>
      <span className="rounded bg-ovr-bg-panel px-1.5 py-0.5 text-[10px] text-ovr-text-muted">
        {run.status}
      </span>
      {run.verification && (
        <span className="flex items-center gap-1 text-[11px] text-ovr-text-dim">
          {verified ? (
            <Check className="size-3 text-ovr-ok" />
          ) : (
            <CircleDot className="size-3 text-ovr-warn" />
          )}
          {verified ? "verified" : "unverified"}
        </span>
      )}
      <button
        data-testid="overdrive-strip-details"
        onClick={() => setDetailsOpen(true)}
        className="text-ovr-text-dim underline-offset-2 hover:text-ovr-text-muted hover:underline"
      >
        Details
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          data-testid="overdrive-strip-reject"
          onClick={handleReject}
          disabled={!canReject}
          className="ovr-btn-danger cursor-pointer px-2.5 py-1 text-[11px] disabled:opacity-40"
        >
          Reject
        </button>
        <button
          data-testid="overdrive-strip-approve"
          onClick={() => overdriveRunStore.approve(run.id)}
          disabled={!canApprove}
          className="ovr-btn-primary cursor-pointer px-2.5 py-1 text-[11px] disabled:opacity-40"
        >
          Approve &amp; merge
        </button>
      </div>

      <RunReviewDialog runId={run.id} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </div>
  )
})
