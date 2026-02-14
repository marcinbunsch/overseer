import { useCallback, useMemo } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, Code, FileText } from "lucide-react"
import { createPlanReviewStore, type PlanReviewNote } from "../../stores/PlanReviewStore"
import { PlanContentTable } from "./PlanContentTable"
import { PlanMarkdownView } from "./PlanMarkdownView"
import { PlanReviewNotesList } from "./PlanReviewNotesList"

interface PlanReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planContent: string
  onSubmitReview: (feedback: string) => void
  onApprove: () => void
}

export const PlanReviewDialog = observer(function PlanReviewDialog({
  open,
  onOpenChange,
  planContent,
  onSubmitReview,
  onApprove,
}: PlanReviewDialogProps) {
  const notesStore = useMemo(() => createPlanReviewStore(), [])

  const lines = useMemo(() => (planContent ? planContent.split("\n") : []), [planContent])

  const handleSubmit = useCallback(() => {
    const message = notesStore.formatReviewMessage(planContent)
    if (message) {
      onSubmitReview(message)
      notesStore.reset()
    }
  }, [notesStore, planContent, onSubmitReview])

  const handleClose = useCallback(() => {
    notesStore.reset()
    onOpenChange(false)
  }, [notesStore, onOpenChange])

  const handleApprove = useCallback(() => {
    notesStore.reset()
    onApprove()
  }, [notesStore, onApprove])

  const handleAddNote = useCallback(() => {
    // Note was added - could scroll to notes sidebar or provide feedback
  }, [])

  const handleNoteClick = useCallback(
    (note: PlanReviewNote) => {
      // Switch to code view if in markdown mode, then edit the note
      if (notesStore.viewMode === "markdown") {
        notesStore.setViewMode("code")
      }
      notesStore.editNote(note)
    },
    [notesStore]
  )

  const onOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault()
  }, [])

  const noteCount = notesStore.notes.length
  const viewMode = notesStore.viewMode

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
              <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
                Review Plan
              </AlertDialog.Title>
              {/* View mode toggle */}
              <div className="flex rounded border border-ovr-border-subtle">
                <button
                  onClick={() => notesStore.setViewMode("markdown")}
                  className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                    viewMode === "markdown"
                      ? "bg-ovr-bg-elevated text-ovr-text-primary"
                      : "text-ovr-text-muted hover:text-ovr-text-secondary"
                  }`}
                  title="Rendered markdown view"
                >
                  <FileText size={12} />
                  <span>Preview</span>
                </button>
                <button
                  onClick={() => notesStore.setViewMode("code")}
                  className={`flex items-center gap-1 border-l border-ovr-border-subtle px-2 py-1 text-xs transition-colors ${
                    viewMode === "code"
                      ? "bg-ovr-bg-elevated text-ovr-text-primary"
                      : "text-ovr-text-muted hover:text-ovr-text-secondary"
                  }`}
                  title="Code view with line numbers"
                >
                  <Code size={12} />
                  <span>Code</span>
                </button>
              </div>
              <span className="text-xs text-ovr-text-dim">
                {viewMode === "code"
                  ? "Click line numbers to select, then add comments"
                  : "Double-click to switch to code view and add comments"}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body - two columns */}
          <div className="flex min-h-0 flex-1">
            {/* Plan content */}
            <div className="min-h-0 flex-1 overflow-auto bg-ovr-bg-app">
              {lines.length > 0 ? (
                viewMode === "code" ? (
                  <PlanContentTable
                    lines={lines}
                    notesStore={notesStore}
                    onAddNote={handleAddNote}
                  />
                ) : (
                  <PlanMarkdownView planContent={planContent} notesStore={notesStore} />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  No plan content
                </div>
              )}
            </div>

            {/* Notes sidebar */}
            <div className="flex w-72 shrink-0 flex-col border-l border-ovr-border-subtle bg-ovr-bg-panel">
              <div className="border-b border-ovr-border-subtle px-3 py-2">
                <div className="text-xs font-medium text-ovr-text-secondary">
                  Comments {noteCount > 0 && `(${noteCount})`}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <PlanReviewNotesList
                  notes={notesStore.notes}
                  onRemoveNote={(id) => notesStore.removeNote(id)}
                  onNoteClick={handleNoteClick}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-ovr-border-subtle px-4 py-3">
            <button onClick={handleClose} className="ovr-btn-ghost px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button onClick={handleApprove} className="ovr-btn-primary px-3 py-1.5 text-sm">
              Approve Plan
            </button>
            <button
              onClick={handleSubmit}
              disabled={noteCount === 0}
              className="ovr-btn px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Submit Review {noteCount > 0 && `(${noteCount} comment${noteCount !== 1 ? "s" : ""})`}
            </button>
          </div>

          <AlertDialog.Description className="sr-only">
            Review the proposed plan and add comments to specific lines
          </AlertDialog.Description>
          <AlertDialog.Action className="sr-only">Close</AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
