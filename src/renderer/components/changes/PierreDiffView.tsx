import { useCallback, useState } from "react"
import { observer } from "mobx-react-lite"
import { PatchDiff, MultiFileDiff, type FileContents } from "@pierre/diffs/react"
import type { SelectedLineRange, FileDiffOptions } from "@pierre/diffs"
import type { DiffNotesStore } from "../../stores/DiffNotesStore"
import { DiffCommentBox } from "./DiffCommentBox"

type DiffStyle = "unified" | "split"

interface PierreDiffViewProps {
  /** Raw unified diff patch string (for git diffs) */
  patch?: string
  /** Old file contents (for comparing two strings) */
  oldFile?: FileContents
  /** New file contents (for comparing two strings) */
  newFile?: FileContents
  /** File path for context */
  filePath: string
  /** Diff notes store for comment management */
  notesStore?: DiffNotesStore
  /** Callback when comment is submitted (non-review mode) */
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
 * Wrapper component for @pierre/diffs that provides:
 * - Unified/split view toggle
 * - Integration with DiffNotesStore for line selection and comments
 * - Overseer theming
 */
export const PierreDiffView = observer(function PierreDiffView({
  patch,
  oldFile,
  newFile,
  filePath,
  notesStore,
  onComment,
  onStartReview,
}: PierreDiffViewProps) {
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified")

  // Map DiffNotesStore selection to @pierre/diffs SelectedLineRange
  // Only show selection if it belongs to this file
  const pendingForThisFile = notesStore?.pending?.filePath === filePath ? notesStore.pending : null
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
      if (!notesStore) return

      if (range === null) {
        notesStore.discardPending()
        return
      }

      // Convert from 1-based line numbers to 0-based indices
      const startIndex = range.start - 1
      const endIndex = range.end - 1

      // Always start a fresh selection - @pierre/diffs handles drag extension internally
      notesStore.startSelection(filePath, startIndex, false)
      if (startIndex !== endIndex) {
        notesStore.extendSelection(endIndex)
      }
    },
    [notesStore, filePath]
  )

  // Common options for both diff types
  const options: FileDiffOptions<undefined> = {
    diffStyle,
    theme: "one-dark-pro",
    disableFileHeader: true, // We handle our own header
    diffIndicators: "classic", // +/- indicators
    lineDiffType: "word", // Word-level highlighting
    enableLineSelection: !!notesStore,
    onLineSelected: handleLineSelected,
  }

  const showCommentBox = notesStore?.hasPendingNote && pendingForThisFile !== null

  return (
    <div className="pierre-diff-container flex flex-col">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {patch ? (
          <PatchDiff patch={patch} options={options} selectedLines={selectedLines} />
        ) : oldFile && newFile ? (
          <MultiFileDiff
            oldFile={oldFile}
            newFile={newFile}
            options={options}
            selectedLines={selectedLines}
          />
        ) : null}
      </div>

      {/* Comment box overlay when selection exists */}
      {showCommentBox && notesStore && (
        <DiffCommentBox
          filePath={filePath}
          notesStore={notesStore}
          onComment={onComment}
          onStartReview={onStartReview}
        />
      )}
    </div>
  )
})
