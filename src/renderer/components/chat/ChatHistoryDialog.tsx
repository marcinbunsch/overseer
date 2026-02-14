import { observer } from "mobx-react-lite"
import { useState } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, RotateCcw, Trash2 } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { AgentIcon } from "./AgentIcon"
import { ConfirmDialog } from "../shared/ConfirmDialog"

interface ChatHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ChatHistoryDialog = observer(function ChatHistoryDialog({
  open,
  onOpenChange,
}: ChatHistoryDialogProps) {
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const archivedChats = workspaceStore?.archivedChats ?? []
  const [reopening, setReopening] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null)

  const handleReopen = async (chatId: string) => {
    setReopening(chatId)
    try {
      await workspaceStore?.reopenArchivedChat(chatId)
      onOpenChange(false)
    } finally {
      setReopening(null)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    await workspaceStore?.deleteChat(pendingDelete.id)
    setPendingDelete(null)
  }

  const formatDate = (date: Date | undefined) => {
    if (!date) return ""
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel shadow-ovr-panel">
          <div className="flex items-center justify-between border-b border-ovr-border-subtle p-4">
            <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
              Chat History
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                <X className="size-4" />
              </button>
            </AlertDialog.Cancel>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {archivedChats.length === 0 ? (
              <div className="py-8 text-center text-xs text-ovr-text-dim">
                No archived chats found
              </div>
            ) : (
              <div className="space-y-2">
                {archivedChats.map((cs) => (
                  <div
                    key={cs.id}
                    className="flex items-center justify-between rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <AgentIcon agentType={cs.chat.agentType} size={16} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-ovr-text-primary">
                          {cs.label}
                        </div>
                        <div className="text-[11px] text-ovr-text-dim">
                          {formatDate(cs.chat.archivedAt)}
                        </div>
                      </div>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleReopen(cs.id)}
                        disabled={reopening !== null}
                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ovr-text-muted hover:bg-ovr-bg-panel hover:text-ovr-text-primary disabled:opacity-50"
                        title="Reopen chat"
                      >
                        <RotateCcw
                          className={`size-3.5 ${reopening === cs.id ? "animate-spin" : ""}`}
                        />
                        Reopen
                      </button>
                      <button
                        onClick={() => setPendingDelete({ id: cs.id, label: cs.label })}
                        disabled={reopening !== null}
                        className="flex items-center rounded p-1 text-ovr-text-dim hover:bg-ovr-bg-panel hover:text-ovr-bad disabled:opacity-50"
                        title="Delete chat permanently"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <AlertDialog.Description className="sr-only">
            View and reopen archived chats
          </AlertDialog.Description>

          <div className="flex justify-end border-t border-ovr-border-subtle p-4">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Close</button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete chat"
        description={`Are you sure you want to permanently delete "${pendingDelete?.label}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </AlertDialog.Root>
  )
})
