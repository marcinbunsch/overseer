import { useState, useEffect } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, Check, AlertTriangle, CircleDot } from "lucide-react"
import { backend } from "../../backend"
import { overdriveRunStore } from "../../stores/OverdriveRunStore"
import { projectRegistry } from "../../stores/ProjectRegistry"
import type { CheckResult, ChangedFile, OverdriveRun } from "../../types"

interface RunReviewDialogProps {
  runId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ChangedFilesResult {
  files: ChangedFile[]
  uncommitted: ChangedFile[]
}

function repoName(repoId: string): string {
  return projectRegistry.projects.find((p) => p.id === repoId)?.name ?? repoId
}

function duration(run: OverdriveRun): string {
  if (!run.endedAt) return "—"
  const ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function CheckBlock({ label, check }: { label: string; check?: CheckResult }) {
  if (!check) return null
  return (
    <div className="rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
      <div className="mb-2 flex items-center gap-2">
        {check.passed ? (
          <Check className="size-3.5 text-ovr-ok" />
        ) : (
          <CircleDot className="size-3.5 text-ovr-warn" />
        )}
        <span className="text-xs font-medium text-ovr-text-primary">{label}</span>
        <span className="text-[10px] text-ovr-text-dim">{check.passed ? "green" : "red"}</span>
      </div>
      <div className="space-y-2">
        {check.commands.map((c, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className={`rounded px-1 py-0.5 font-mono ${
                  c.success ? "bg-ovr-ok/15 text-ovr-ok" : "bg-ovr-bad/15 text-ovr-bad"
                }`}
              >
                exit {c.exitCode}
                {c.timedOut ? " ⏱" : ""}
              </span>
              <code className="truncate text-ovr-text-muted">{c.command}</code>
              <span className="ml-auto shrink-0 text-ovr-text-dim">{c.durationMs}ms</span>
            </div>
            {(c.stdoutTail || c.stderrTail) && (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-ovr-bg-panel p-2 text-[10px] text-ovr-text-dim">
                {c.stdoutTail}
                {c.stderrTail}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export const RunReviewDialog = observer(function RunReviewDialog({
  runId,
  open,
  onOpenChange,
}: RunReviewDialogProps) {
  const run = runId ? overdriveRunStore.getRun(runId) : undefined
  const [changed, setChanged] = useState<ChangedFilesResult | null>(null)

  useEffect(() => {
    if (!open || !run?.workspacePath) {
      setChanged(null)
      return
    }
    let cancelled = false
    backend
      .invoke<ChangedFilesResult>("list_changed_files", { workspacePath: run.workspacePath })
      .then((res) => {
        if (!cancelled) setChanged(res)
      })
      .catch(() => {
        if (!cancelled) setChanged(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, run?.workspacePath])

  if (!run) return null

  const v = run.verification
  const files = [...(changed?.files ?? []), ...(changed?.uncommitted ?? [])]
  const canApprove = run.status === "needsReview"
  const canReject = ["needsReview", "needsInput", "failed"].includes(run.status)

  const handleApprove = async () => {
    await overdriveRunStore.approve(run.id)
    onOpenChange(false)
  }
  const handleReject = async () => {
    await overdriveRunStore.reject(run.id)
    onOpenChange(false)
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-180 -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <div className="flex items-start justify-between">
            <div>
              <AlertDialog.Title
                className="text-sm font-semibold text-ovr-text-strong"
                data-testid="run-review-title"
              >
                {run.branch ?? run.id}
              </AlertDialog.Title>
              <p className="mt-0.5 text-[11px] text-ovr-text-dim">
                {repoName(run.repoId)} · {run.status} · {run.iterationsUsed} iterations ·{" "}
                {run.verifyBounces} bounces · {duration(run)}
              </p>
            </div>
            <AlertDialog.Cancel asChild>
              <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                <X className="size-4" />
              </button>
            </AlertDialog.Cancel>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
            {run.error && (
              <div className="flex gap-2 rounded-lg border border-ovr-warn/40 bg-ovr-warn/10 p-3 text-xs text-ovr-text-primary">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-ovr-warn" />
                <span>{run.error}</span>
              </div>
            )}

            {run.result && (
              <div className="rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
                <p className="mb-1 text-xs font-medium text-ovr-text-primary">Summary</p>
                <p className="text-xs text-ovr-text-muted">{run.result.summary}</p>
                {run.result.assumptions.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-[11px] text-ovr-text-dim">
                    {run.result.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {v && (
              <>
                <CheckBlock label="Red check (expected to fail)" check={v.redCheck} />
                <CheckBlock label="Final verify (expected to pass)" check={v.finalCheck} />
                {v.harnessDrift && (
                  <div className="rounded-lg border border-ovr-warn/40 bg-ovr-warn/10 p-3 text-[11px] text-ovr-text-primary">
                    <p className="mb-1 font-medium">Harness drift</p>
                    <pre className="whitespace-pre-wrap text-ovr-text-muted">{v.harnessDrift}</pre>
                  </div>
                )}
              </>
            )}

            <div className="rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
              <p className="mb-1.5 text-xs font-medium text-ovr-text-primary">
                Changed files{files.length ? ` (${files.length})` : ""}
              </p>
              {files.length === 0 ? (
                <p className="text-[11px] text-ovr-text-dim">No changes detected.</p>
              ) : (
                <div className="space-y-0.5">
                  {files.map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-[11px]">
                      <span className="w-3 font-mono text-ovr-text-dim">{f.status}</span>
                      <code className="truncate text-ovr-text-muted">{f.path}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-ovr-text-dim">Workspace: {run.workspacePath ?? "—"}</p>
          </div>

          <div className="mt-4 flex justify-end gap-3 border-t border-ovr-border-subtle pt-4">
            <button
              data-testid="run-reject"
              onClick={handleReject}
              disabled={!canReject}
              className="ovr-btn-danger cursor-pointer px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Reject
            </button>
            <button
              data-testid="run-approve"
              onClick={handleApprove}
              disabled={!canApprove}
              className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Approve
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
