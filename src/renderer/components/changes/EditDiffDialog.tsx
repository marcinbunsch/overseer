import { useCallback, useEffect, useMemo } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import type { FileContents } from "@pierre/diffs/react"
import { getLanguage } from "./diffRendering"
import { externalService } from "../../services/external"
import { PierreDiffView } from "./PierreDiffView"

interface EditDiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string
  oldString: string
  newString: string
  label?: string
}

export function EditDiffDialog({
  open,
  onOpenChange,
  filePath,
  oldString,
  newString,
  label = "Edit",
}: EditDiffDialogProps) {
  const fileName = filePath.split("/").pop() ?? filePath

  // Convert old/new strings to FileContents format for @pierre/diffs
  const oldFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: oldString,
      lang: getLanguage(filePath) as FileContents["lang"],
    }),
    [filePath, oldString]
  )

  const newFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: newString,
      lang: getLanguage(filePath) as FileContents["lang"],
    }),
    [filePath, newString]
  )

  const hasChanges = oldString !== newString

  const handleComment = useCallback(
    (
      _filePath: string,
      lineContent: string,
      startLine: number,
      endLine: number,
      comment: string
    ) => {
      const workspaceStore = projectRegistry.selectedWorkspaceStore
      if (!workspaceStore) return
      const lineRef = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
      const message = `Comment on ${_filePath} (${lineRef}):\n\`\`\`\n${lineContent}\n\`\`\`\n\n${comment}`
      workspaceStore.sendMessage(message)
    },
    []
  )

  const onOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault()
  }, [])

  // Handle Cmd+O to open file in editor
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.key === "o" && e.metaKey) {
        e.preventDefault()
        externalService.openInEditor(filePath)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, filePath])

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content
          className="fixed inset-10 z-50 flex flex-col overflow-hidden rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel shadow-ovr-panel"
          onOpenAutoFocus={onOpenAutoFocus}
          onEscapeKeyDown={(e) => {
            // Let textarea handle its own ESC behavior
            if (e.target instanceof HTMLTextAreaElement) {
              e.preventDefault()
            }
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ovr-border-subtle px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <AlertDialog.Title className="truncate font-mono text-sm font-semibold text-ovr-text-strong">
                {fileName}
              </AlertDialog.Title>
              <span className="text-xs text-ovr-text-dim">{filePath}</span>
              <span className="shrink-0 rounded border border-ovr-border-subtle px-1.5 py-0.5 text-xs text-ovr-text-primary">
                {label}
              </span>
            </div>
            <AlertDialog.Cancel asChild>
              <button className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary">
                <X size={16} />
              </button>
            </AlertDialog.Cancel>
          </div>

          {/* Diff content */}
          <div className="flex min-h-0 flex-1 flex-col bg-ovr-bg-app">
            {hasChanges ? (
              <PierreDiffView
                oldFile={oldFile}
                newFile={newFile}
                filePath={filePath}
                onComment={handleComment}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                No changes
              </div>
            )}
          </div>

          <AlertDialog.Description className="sr-only">
            {label} diff for {filePath}
          </AlertDialog.Description>
          <AlertDialog.Action className="sr-only">Close</AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
