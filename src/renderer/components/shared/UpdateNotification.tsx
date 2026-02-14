import { observer } from "mobx-react-lite"
import { X, Download, Loader2 } from "lucide-react"
import { updateStore } from "../../stores/UpdateStore"

export const UpdateNotification = observer(function UpdateNotification() {
  if (!updateStore.availableUpdate || updateStore.notificationDismissed) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-ovr-azure-500/30 bg-ovr-bg-panel p-4 shadow-ovr-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-ovr-text-primary">
            Update available: v{updateStore.availableUpdate.version}
          </p>
          {updateStore.availableUpdate.body && (
            <p className="mt-1 line-clamp-2 text-xs text-ovr-text-dim">
              {updateStore.availableUpdate.body}
            </p>
          )}
        </div>
        <button
          onClick={() => updateStore.dismissNotification()}
          className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted"
          title="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>

      {updateStore.error && <p className="mt-2 text-xs text-ovr-error">{updateStore.error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          onClick={() => updateStore.downloadAndInstall()}
          disabled={updateStore.isDownloading}
          className="ovr-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          {updateStore.isDownloading ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Installing...
            </>
          ) : (
            <>
              <Download className="size-3" />
              Install & Restart
            </>
          )}
        </button>
      </div>
    </div>
  )
})
