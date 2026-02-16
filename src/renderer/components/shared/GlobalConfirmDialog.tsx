import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { observer } from "mobx-react-lite"
import { confirmDialogStore } from "../../stores/ConfirmDialogStore"

export const GlobalConfirmDialog = observer(function GlobalConfirmDialog() {
  const current = confirmDialogStore.current

  return (
    <AlertDialog.Root
      open={current !== null}
      onOpenChange={(open) => {
        if (!open) {
          confirmDialogStore.handleCancel()
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-100 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
            {current?.title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
            {current?.description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button
                className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs"
                onClick={() => confirmDialogStore.handleCancel()}
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="ovr-btn-danger cursor-pointer px-3 py-1.5 text-xs"
                onClick={() => confirmDialogStore.handleConfirm()}
              >
                {current?.confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
