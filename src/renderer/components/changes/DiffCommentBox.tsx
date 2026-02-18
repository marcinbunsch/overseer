import { useEffect, useRef } from "react"
import { observer } from "mobx-react-lite"
import type { DiffNotesStore } from "../../stores/DiffNotesStore"
import { ConfirmDialog } from "../shared/ConfirmDialog"
import { Textarea } from "../shared/Textarea"

interface DiffCommentBoxProps {
  filePath: string
  notesStore: DiffNotesStore
  /** Callback for immediate send mode */
  onComment?: (
    filePath: string,
    lineContent: string,
    startLine: number,
    endLine: number,
    comment: string
  ) => void
  /** Callback when "Start Review" is clicked */
  onStartReview?: () => void
}

/**
 * Comment input box for diff line selections.
 * Handles both immediate send and review collection modes.
 */
export const DiffCommentBox = observer(function DiffCommentBox({
  filePath,
  notesStore,
  onComment,
  onStartReview,
}: DiffCommentBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const pending = notesStore.pending
  if (!pending) return null

  const commentText = pending.commentText
  const startLine = Math.min(pending.anchorIndex, pending.focusIndex) + 1
  const endLine = Math.max(pending.anchorIndex, pending.focusIndex) + 1

  const fileName = filePath.split("/").pop() ?? filePath
  const lineRef = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`

  const handleEscape = () => {
    if (!commentText.trim()) {
      notesStore.discardPending()
    } else {
      notesStore.showDiscardDialog = true
    }
  }

  const handleConfirmDiscard = () => {
    notesStore.showDiscardDialog = false
    notesStore.discardPending()
  }

  const handleSubmit = () => {
    if (!commentText.trim()) return

    // Generate line content snippet for the note
    // This will be populated by the actual diff content - for now use placeholder
    const lineContent = `(selected ${lineRef})`

    if (notesStore.reviewMode) {
      // In review mode, submit to notes collection
      notesStore.submitNote(lineContent, startLine, endLine)
    } else if (onComment) {
      // Immediate send mode
      onComment(filePath, lineContent, startLine, endLine, commentText)
      notesStore.discardPending()
    }
  }

  const handleStartReview = () => {
    onStartReview?.()
    handleSubmit()
  }

  const isEditing = notesStore.isEditing
  const isReviewMode = notesStore.reviewMode

  return (
    <>
      <div className="border-t border-ovr-border-subtle bg-ovr-bg-elevated px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-ovr-text-muted">
            <span className="font-medium text-ovr-text-secondary">{fileName}</span>
            <span>{lineRef}</span>
          </div>
          <Textarea
            ref={textareaRef}
            value={commentText}
            onChange={(e) => notesStore.updateComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                handleEscape()
              }
            }}
            placeholder="Add a comment about the selected lines..."
            rows={3}
            className="resize-none text-sm placeholder:text-ovr-text-muted"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              data-testid="comment-cancel-button"
              onClick={() => {
                if (commentText.trim()) {
                  notesStore.showDiscardDialog = true
                } else {
                  notesStore.discardPending()
                }
              }}
              className="ovr-btn-ghost cursor-pointer px-2 py-1 text-xs"
            >
              Cancel
            </button>
            {isReviewMode ? (
              <button
                data-testid="comment-submit-button"
                onClick={handleSubmit}
                disabled={!commentText.trim()}
                className="ovr-btn-primary cursor-pointer px-2 py-1 text-xs disabled:opacity-50"
              >
                {isEditing ? "Save" : "Add Comment"}
              </button>
            ) : (
              <>
                <button
                  data-testid="comment-submit-button"
                  onClick={handleSubmit}
                  disabled={!commentText.trim()}
                  className="ovr-btn-primary cursor-pointer px-2 py-1 text-xs disabled:opacity-50"
                >
                  Send Comment
                </button>
                {onStartReview && (
                  <button
                    data-testid="start-review-button"
                    onClick={handleStartReview}
                    disabled={!commentText.trim()}
                    className="ovr-btn cursor-pointer bg-ovr-ok px-2 py-1 text-xs text-ovr-bg-base disabled:opacity-50"
                  >
                    Start Review
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
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
    </>
  )
})
