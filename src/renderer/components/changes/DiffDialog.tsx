import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { createDiffNotesStore, type DiffNote } from "../../stores/DiffNotesStore"
import { createDiffViewStore } from "../../stores/DiffViewStore"
import { STATUS_STYLES, STATUS_LABELS } from "../../constants/git"
import type { ChangedFile } from "../../types"
import { ConfirmDialog } from "../shared/ConfirmDialog"
import { CodeReviewNotesList } from "./CodeReviewNotesList"
import { externalService } from "../../services/external"
import { PierreDiffView } from "./PierreDiffView"

interface DiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspacePath: string
  uncommittedFiles: ChangedFile[]
  branchFiles: ChangedFile[]
  initialFile: ChangedFile
}

export const DiffDialog = observer(function DiffDialog({
  open,
  onOpenChange,
  workspacePath,
  uncommittedFiles,
  branchFiles,
  initialFile,
}: DiffDialogProps) {
  // Combine all files for navigation (memoized to avoid re-renders)
  const allFiles = useMemo(
    () => [...uncommittedFiles, ...branchFiles],
    [uncommittedFiles, branchFiles]
  )
  const fetchedRef = useRef<string | null>(null)
  const [pendingFile, setPendingFile] = useState<ChangedFile | null>(null)
  const [uncommittedCollapsed, setUncommittedCollapsed] = useState(false)
  const [branchCollapsed, setBranchCollapsed] = useState(false)
  // Hide sidebar by default on small screens
  const [sidebarVisible, setSidebarVisible] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768
  )

  // Create store instances for this dialog
  const notesStore = useMemo(() => createDiffNotesStore(), [])
  const diffStore = useMemo(
    () => createDiffViewStore(workspacePath, initialFile),
    [workspacePath, initialFile]
  )

  // Set up the submit callback to send to chat
  useEffect(() => {
    notesStore.setOnSubmit((note) => {
      const message = `Comment on ${note.filePath} (${note.startLine === note.endLine ? `line ${note.startLine}` : `lines ${note.startLine}-${note.endLine}`}):\n\`\`\`\n${note.lineContent}\n\`\`\`\n\n${note.comment}`
      const workspaceStore = projectRegistry.selectedWorkspaceStore
      workspaceStore?.sendMessage(message)
    })
  }, [notesStore])

  // Reset stores when dialog closes
  useEffect(() => {
    if (!open) {
      notesStore.reset()
      diffStore.reset()
    }
  }, [open, notesStore, diffStore])

  const onOpenAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault()
      if (fetchedRef.current === initialFile.path) return
      fetchedRef.current = initialFile.path
      diffStore.selectFile(initialFile)
    },
    [initialFile, diffStore]
  )

  const handleSelectFile = useCallback(
    (file: ChangedFile) => {
      // Check if there's an unsaved comment
      if (notesStore.hasUnsavedComment) {
        setPendingFile(file)
        notesStore.showDiscardDialog = true
        return
      }
      notesStore.discardPending()
      diffStore.selectFile(file)
    },
    [diffStore, notesStore]
  )

  const handleConfirmDiscard = useCallback(() => {
    if (pendingFile) {
      notesStore.discardPending()
      diffStore.selectFile(pendingFile)
      setPendingFile(null)
    } else {
      // ESC pressed without pending file - just discard
      notesStore.discardPending()
    }
  }, [pendingFile, diffStore, notesStore])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        // Check for unsaved review notes
        if (notesStore.hasReviewNotes) {
          notesStore.requestDiscardReview()
          return
        }
        // Check for unsaved comment
        if (notesStore.hasUnsavedComment) {
          notesStore.showDiscardDialog = true
          return
        }
        fetchedRef.current = null
        diffStore.reset()
        notesStore.reset()
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange, diffStore, notesStore]
  )

  const handleStartReview = useCallback(() => {
    // Enable review mode and submit the current pending note as the first review comment
    notesStore.setReviewMode(true)
    // The pending note will be submitted via the normal submit flow
    // which now adds to notes array since reviewMode is true
  }, [notesStore])

  const handleSubmitReview = useCallback(() => {
    const message = notesStore.formatReviewMessage()
    if (message) {
      const workspaceStore = projectRegistry.selectedWorkspaceStore
      workspaceStore?.sendMessage(message)
    }
    notesStore.reset()
    fetchedRef.current = null
    diffStore.reset()
    onOpenChange(false)
  }, [notesStore, diffStore, onOpenChange])

  const handleCancelReview = useCallback(() => {
    if (notesStore.hasReviewNotes || notesStore.hasUnsavedComment) {
      notesStore.requestDiscardReview()
    } else {
      notesStore.setReviewMode(false)
    }
  }, [notesStore])

  const handleConfirmDiscardReview = useCallback(() => {
    notesStore.confirmDiscardReview()
    // Stay in the dialog, just exit review mode
  }, [notesStore])

  const handleNoteClick = useCallback(
    (note: DiffNote) => {
      // Switch to the file containing the note if different
      const targetFile = [...uncommittedFiles, ...branchFiles].find((f) => f.path === note.filePath)
      if (targetFile && targetFile.path !== diffStore.selectedFile.path) {
        diffStore.selectFile(targetFile)
      }
      // Load the note for editing
      notesStore.editNote(note)
    },
    [uncommittedFiles, branchFiles, diffStore, notesStore]
  )

  const handleComment = useCallback(
    (
      _filePath: string,
      lineContent: string,
      startLine: number,
      endLine: number,
      comment: string
    ) => {
      const lineRef = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
      const message = `Comment on ${_filePath} (${lineRef}):\n\`\`\`\n${lineContent}\n\`\`\`\n\n${comment}`
      const workspaceStore = projectRegistry.selectedWorkspaceStore
      workspaceStore?.sendMessage(message)
    },
    []
  )

  // Handle ESC when not in textarea - check for unsaved notes
  const handleEscapeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // If textarea is focused, let it handle ESC
      if (e.target instanceof HTMLTextAreaElement) {
        e.preventDefault()
        return
      }
      // If there's an unsaved comment, show discard dialog
      if (notesStore.hasUnsavedComment) {
        e.preventDefault()
        notesStore.showDiscardDialog = true
      }
      // Otherwise, let the dialog close normally
    },
    [notesStore]
  )

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return
      const idx = allFiles.findIndex((f) => f.path === diffStore.selectedFile.path)
      if (e.key === "ArrowLeft" && idx > 0) {
        e.preventDefault()
        handleSelectFile(allFiles[idx - 1])
      } else if (e.key === "ArrowRight" && idx < allFiles.length - 1) {
        e.preventDefault()
        handleSelectFile(allFiles[idx + 1])
      } else if (e.key === "o" && e.metaKey) {
        e.preventDefault()
        const fullPath = `${workspacePath}/${diffStore.selectedFile.path}`
        externalService.openInEditor(fullPath)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, allFiles, diffStore.selectedFile.path, handleSelectFile, workspacePath])

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content
          className="fixed inset-10 z-50 flex flex-col overflow-hidden rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel shadow-ovr-panel"
          onOpenAutoFocus={onOpenAutoFocus}
          onEscapeKeyDown={handleEscapeKeyDown}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ovr-border-subtle px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={() => setSidebarVisible(!sidebarVisible)}
                className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
                title={sidebarVisible ? "Hide file list" : "Show file list"}
              >
                {sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
              </button>
              <AlertDialog.Title className="truncate font-mono text-sm font-semibold text-ovr-text-strong">
                {diffStore.fileName}
              </AlertDialog.Title>
              <span className="hidden text-xs text-ovr-text-dim md:inline">
                {diffStore.selectedFile.path}
              </span>
              <StatusBadge status={diffStore.selectedFile.status} />
            </div>
            <AlertDialog.Cancel asChild>
              <button className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary">
                <X size={16} />
              </button>
            </AlertDialog.Cancel>
          </div>

          {/* Body: sidebar + diff */}
          <div className="flex min-h-0 flex-1">
            {/* File list sidebar - hidden on mobile by default, toggleable */}
            {sidebarVisible && (
              <div className="w-56 shrink-0 overflow-y-auto border-r border-ovr-border-subtle bg-ovr-bg-panel">
                {/* Uncommitted Changes Section */}
                {uncommittedFiles.length > 0 && (
                  <div>
                    <button
                      onClick={() => setUncommittedCollapsed(!uncommittedCollapsed)}
                      className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1.5 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5 text-left text-xs font-medium text-ovr-text-muted hover:bg-ovr-bg-elevated/50"
                    >
                      {uncommittedCollapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      <span className="flex-1">Uncommitted Changes</span>
                      <span className="text-ovr-text-dim">{uncommittedFiles.length}</span>
                    </button>
                    {!uncommittedCollapsed &&
                      uncommittedFiles.map((file) => {
                        const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
                        const isSelected =
                          file.path === diffStore.selectedFile.path && file.isUncommitted
                        return (
                          <button
                            key={`uncommitted-${file.status}-${file.path}`}
                            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-ovr-bg-elevated/50 ${
                              isSelected
                                ? "bg-ovr-bg-elevated text-ovr-text-strong"
                                : "text-ovr-text-primary"
                            }`}
                            onClick={() => handleSelectFile(file)}
                          >
                            <span
                              className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                            >
                              {style.label}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {file.path.split("/").pop()}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                )}

                {/* Branch Changes Section */}
                {branchFiles.length > 0 && (
                  <div>
                    <button
                      onClick={() => setBranchCollapsed(!branchCollapsed)}
                      className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1.5 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5 text-left text-xs font-medium text-ovr-text-muted hover:bg-ovr-bg-elevated/50"
                    >
                      {branchCollapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      <span className="flex-1">Branch Changes</span>
                      <span className="text-ovr-text-dim">{branchFiles.length}</span>
                    </button>
                    {!branchCollapsed &&
                      branchFiles.map((file) => {
                        const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
                        const isSelected =
                          file.path === diffStore.selectedFile.path && !file.isUncommitted
                        return (
                          <button
                            key={`branch-${file.status}-${file.path}`}
                            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-ovr-bg-elevated/50 ${
                              isSelected
                                ? "bg-ovr-bg-elevated text-ovr-text-strong"
                                : "text-ovr-text-primary"
                            }`}
                            onClick={() => handleSelectFile(file)}
                          >
                            <span
                              className={`w-3 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                            >
                              {style.label}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {file.path.split("/").pop()}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Diff content */}
            <div className="flex min-h-0 flex-1 flex-col bg-ovr-bg-app">
              {diffStore.status === "loading" && (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  Loading diff...
                </div>
              )}
              {diffStore.status === "error" && (
                <div className="flex h-full items-center justify-center text-sm text-ovr-bad">
                  {diffStore.errorMessage}
                </div>
              )}
              {diffStore.status === "done" && !diffStore.diff && (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  No changes in this file
                </div>
              )}
              {diffStore.status === "done" && diffStore.diff && (
                <PierreDiffView
                  patch={diffStore.diff}
                  filePath={diffStore.selectedFile.path}
                  notesStore={notesStore}
                  onComment={handleComment}
                  onStartReview={handleStartReview}
                />
              )}
            </div>

            {/* Review notes sidebar - only visible in review mode */}
            {notesStore.reviewMode && (
              <div
                data-testid="review-notes-sidebar"
                className="flex w-72 shrink-0 flex-col border-l border-ovr-border-subtle bg-ovr-bg-panel"
              >
                <div className="border-b border-ovr-border-subtle px-3 py-2 text-xs font-medium text-ovr-text-muted">
                  Review Notes ({notesStore.notes.length})
                </div>
                <div className="flex-1 overflow-y-auto">
                  <CodeReviewNotesList
                    notes={notesStore.notes}
                    currentFilePath={diffStore.selectedFile.path}
                    onRemoveNote={(noteId) => notesStore.removeNote(noteId)}
                    onNoteClick={handleNoteClick}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer - only visible in review mode */}
          {notesStore.reviewMode && (
            <div className="flex items-center justify-end gap-2 border-t border-ovr-border-subtle px-4 py-3">
              <button
                data-testid="cancel-review-button"
                onClick={handleCancelReview}
                className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                data-testid="submit-review-button"
                onClick={handleSubmitReview}
                disabled={!notesStore.hasReviewNotes}
                className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Submit Review{notesStore.hasReviewNotes && ` (${notesStore.notes.length})`}
              </button>
            </div>
          )}

          <AlertDialog.Description className="sr-only">
            Diff view for {diffStore.selectedFile.path}
          </AlertDialog.Description>
          <AlertDialog.Action className="sr-only">Close</AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
      <ConfirmDialog
        open={notesStore.showDiscardDialog}
        onOpenChange={(open) => {
          notesStore.showDiscardDialog = open
        }}
        title="Discard comment?"
        description="You have unsaved comment text that will be lost."
        confirmLabel="Discard"
        onConfirm={handleConfirmDiscard}
      />
      <ConfirmDialog
        open={notesStore.showDiscardReviewDialog}
        onOpenChange={(open) => {
          notesStore.showDiscardReviewDialog = open
        }}
        title="Discard review?"
        description={`You have ${notesStore.notes.length} unsaved review comment${notesStore.notes.length === 1 ? "" : "s"} that will be lost.`}
        confirmLabel="Discard"
        onConfirm={handleConfirmDiscardReview}
      />
    </AlertDialog.Root>
  )
})

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? STATUS_LABELS["?"]
  return (
    <span
      className={`shrink-0 rounded border border-ovr-border-subtle px-1.5 py-0.5 text-xs ${s.color}`}
    >
      {s.label}
    </span>
  )
}
