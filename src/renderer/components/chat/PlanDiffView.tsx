import { useCallback, useState, useRef, useEffect } from "react"
import { observer } from "mobx-react-lite"
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react"
import type { SelectedLineRange, FileDiffOptions } from "@pierre/diffs"
import type { PlanReviewStore } from "../../stores/PlanReviewStore"
import { PLAN_FILE_PATH } from "../../stores/PlanReviewStore"
import { ConfirmDialog } from "../shared/ConfirmDialog"

type DiffStyle = "unified" | "split"

interface PlanDiffViewProps {
  /** Current plan content */
  planContent: string
  /** Previous plan content (null for first submission - shows all as additions) */
  previousPlanContent: string | null
  /** Plan review store for comment management */
  notesStore: PlanReviewStore
  /** Callback when a note is added */
  onAddNote: () => void
}

/**
 * Diff view for plan review using @pierre/diffs.
 * Shows plan changes with line selection and inline commenting.
 */
export const PlanDiffView = observer(function PlanDiffView({
  planContent,
  previousPlanContent,
  notesStore,
  onAddNote,
}: PlanDiffViewProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified")
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to highlighted line when switching from markdown view
  const highlightedLine = notesStore.highlightedLine
  useEffect(() => {
    if (highlightedLine === null || !containerRef.current) return

    // Convert 0-based index to 1-based line number for pierre/diffs
    const lineNumber = highlightedLine + 1

    // Find the line element - pierre/diffs uses data-line attribute
    const lineElement = containerRef.current.querySelector(`[data-line="${lineNumber}"]`)
    if (lineElement) {
      lineElement.scrollIntoView({ behavior: "smooth", block: "center" })

      // Add a brief highlight effect
      lineElement.classList.add("plan-diff-highlight")
      setTimeout(() => {
        lineElement.classList.remove("plan-diff-highlight")
      }, 1500)
    }

    // Clear the highlight after scrolling
    notesStore.clearHighlight()
  }, [highlightedLine, notesStore])

  // Create FileContents for old/new
  const oldFile: FileContents = {
    name: PLAN_FILE_PATH,
    contents: previousPlanContent ?? "", // Empty string for first submission
    lang: "markdown",
  }

  const newFile: FileContents = {
    name: PLAN_FILE_PATH,
    contents: planContent,
    lang: "markdown",
  }

  // Map PlanReviewStore selection to @pierre/diffs SelectedLineRange
  const pendingForThisFile =
    notesStore.pending?.filePath === PLAN_FILE_PATH ? notesStore.pending : null
  const selectedLines: SelectedLineRange | null = pendingForThisFile
    ? {
        // Convert from 0-based index to 1-based line number
        start: Math.min(pendingForThisFile.anchorIndex, pendingForThisFile.focusIndex) + 1,
        end: Math.max(pendingForThisFile.anchorIndex, pendingForThisFile.focusIndex) + 1,
      }
    : null

  // Handle line selection from @pierre/diffs
  const handleLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      if (range === null) {
        notesStore.discardPending()
        return
      }

      // Convert from 1-based line numbers to 0-based indices
      const startIndex = range.start - 1
      const endIndex = range.end - 1

      // Always start a fresh selection - @pierre/diffs handles drag extension internally
      notesStore.startSelection(PLAN_FILE_PATH, startIndex, false)
      if (startIndex !== endIndex) {
        notesStore.extendSelection(endIndex)
      }
    },
    [notesStore]
  )

  // Diff options
  const options: FileDiffOptions<undefined> = {
    diffStyle,
    theme: "one-dark-pro",
    disableFileHeader: true, // We handle our own header
    diffIndicators: "classic", // +/- indicators
    lineDiffType: "word", // Word-level highlighting
    expandUnchanged: true, // Always show all lines, never collapse unchanged content
    enableLineSelection: true,
    onLineSelected: handleLineSelected,
  }

  const showCommentBox = notesStore.hasPendingNote && pendingForThisFile !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* View mode toggle */}
      <div className="flex items-center justify-end gap-1 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5">
        <span className="mr-2 text-xs text-ovr-text-muted">View:</span>
        <button
          className={`cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
            diffStyle === "unified"
              ? "bg-ovr-azure-500/20 text-ovr-azure-400"
              : "text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
          }`}
          onClick={() => setDiffStyle("unified")}
        >
          Unified
        </button>
        <button
          className={`cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
            diffStyle === "split"
              ? "bg-ovr-azure-500/20 text-ovr-azure-400"
              : "text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
          }`}
          onClick={() => setDiffStyle("split")}
        >
          Split
        </button>
      </div>

      {/* Diff content */}
      <div ref={containerRef} className="pierre-diff-container min-h-0 flex-1 overflow-auto">
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={options}
          selectedLines={selectedLines}
        />
      </div>

      {/* Comment box when selection exists */}
      {showCommentBox && (
        <PlanCommentBox notesStore={notesStore} planContent={planContent} onAddNote={onAddNote} />
      )}
    </div>
  )
})

interface PlanCommentBoxProps {
  notesStore: PlanReviewStore
  planContent: string
  onAddNote: () => void
}

/**
 * Inline comment box for plan diff view.
 */
const PlanCommentBox = observer(function PlanCommentBox({
  notesStore,
  planContent,
  onAddNote,
}: PlanCommentBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const pending = notesStore.pending
  if (!pending) return null

  const commentText = pending.commentText
  const startLine = Math.min(pending.anchorIndex, pending.focusIndex) + 1
  const endLine = Math.max(pending.anchorIndex, pending.focusIndex) + 1

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

    // Get the line content for the selected range
    const lines = planContent.split("\n")
    const selectedLines = lines.slice(startLine - 1, endLine)
    const lineContent = selectedLines.join("\n")

    notesStore.addNote(lineContent, startLine, endLine)
    onAddNote()
  }

  const isEditing = notesStore.isEditing

  return (
    <>
      <div className="border-t border-ovr-border-subtle bg-ovr-bg-elevated px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-ovr-text-muted">
            <span>{lineRef}</span>
          </div>
          <textarea
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
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="resize-none overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted focus:border-ovr-azure-500 focus:shadow-[var(--shadow-ovr-glow-soft)]"
          />
          <div className="flex items-center justify-end gap-2">
            <button
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
            <button
              onClick={handleSubmit}
              disabled={!commentText.trim()}
              className="ovr-btn-primary cursor-pointer px-2 py-1 text-xs disabled:opacity-50"
            >
              {isEditing ? "Save" : "Add Comment"}
            </button>
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
