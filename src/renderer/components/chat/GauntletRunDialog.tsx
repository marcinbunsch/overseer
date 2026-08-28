import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { useState, useEffect } from "react"
import { observer } from "mobx-react-lite"
import { Input } from "../shared/Input"
import { Checkbox } from "../shared/Checkbox"
import { gauntletStore } from "../../stores/GauntletStore"
import { getAgentDisplayName } from "../../utils/agentDisplayName"
import type { GauntletReviewer } from "../../types"

interface GauntletRunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRun: (reviewers: GauntletReviewer[], maxIterations: number) => void
}

export const GauntletRunDialog = observer(function GauntletRunDialog({
  open,
  onOpenChange,
  onRun,
}: GauntletRunDialogProps) {
  const [maxIterations, setMaxIterations] = useState(25)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setMaxIterations(25)
      setSelectedIds(new Set(gauntletStore.enabledReviewers.map((r) => r.id)))
    }
  }, [open])

  const toggle = (id: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selected = gauntletStore.reviewers.filter((r) => selectedIds.has(r.id))

  const handleRun = () => {
    if (selected.length === 0) return
    onRun(selected, maxIterations)
    onOpenChange(false)
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
            Run Gauntlet
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-ovr-text-muted">
            Review the current work in this workspace. Each round runs every selected reviewer;
            issues are fixed and re-reviewed until all pass. Runs in YOLO mode.
          </AlertDialog.Description>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2.5">
              {gauntletStore.reviewers.length === 0 && (
                <p className="text-[11px] text-ovr-text-muted">
                  No reviewers configured. Add some in Settings → Gauntlet.
                </p>
              )}
              {gauntletStore.reviewers.map((reviewer) => (
                <label
                  key={reviewer.id}
                  className="flex cursor-pointer items-center gap-2"
                  data-testid={`gauntlet-run-select-${reviewer.id}`}
                >
                  <Checkbox
                    checked={selectedIds.has(reviewer.id)}
                    onChange={(e) => toggle(reviewer.id, e.target.checked)}
                  />
                  <span className="text-xs text-ovr-text-primary">{reviewer.name}</span>
                  <span className="text-[11px] text-ovr-text-muted">
                    {getAgentDisplayName(reviewer.agentType)}
                    {reviewer.modelVersion ? ` · ${reviewer.modelVersion}` : ""}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-ovr-text-secondary">Max iterations</label>
              <Input
                type="number"
                value={maxIterations}
                onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                max={100}
                className="w-20"
                data-testid="gauntlet-run-max-iterations"
              />
              <span className="rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-warning">
                YOLO mode
              </span>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Cancel</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="ovr-btn-primary cursor-pointer px-4 py-1.5 text-xs"
                onClick={handleRun}
                disabled={selected.length === 0}
                data-testid="gauntlet-run-start-button"
              >
                Run Gauntlet
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
