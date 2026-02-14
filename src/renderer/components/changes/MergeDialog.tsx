import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { useState } from "react"

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerge: (archiveAfter: boolean, deleteBranch: boolean) => void
}

export function MergeDialog({ open, onOpenChange, onMerge }: MergeDialogProps) {
  const [deleteBranch, setDeleteBranch] = useState(true)

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-100 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
            Merge into default branch
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
            No conflicts detected. How would you like to proceed?
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button
                data-testid="cancel-merge-button"
                className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                data-testid="just-merge-button"
                className="ovr-btn cursor-pointer px-3 py-1.5 text-xs"
                // just merge cannot delete the branch, so deleteBranch is false here
                onClick={() => onMerge(false, false)}
              >
                Just merge
              </button>
            </AlertDialog.Action>
            <AlertDialog.Action asChild>
              <button
                data-testid="merge-archive-button"
                className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs"
                onClick={() => onMerge(true, deleteBranch)}
              >
                Merge & archive
              </button>
            </AlertDialog.Action>
          </div>
          <div className="mt-3 flex justify-end">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ovr-text-muted">
              <input
                type="checkbox"
                data-testid="delete-branch-checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
                className="size-3.5 cursor-pointer accent-ovr-azure-500"
              />
              Also remove branch
            </label>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
