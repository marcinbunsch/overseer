import { observer } from "mobx-react-lite"
import { X } from "lucide-react"
import type { DiffNote } from "../../stores/DiffNotesStore"

interface CodeReviewNotesListProps {
  notes: DiffNote[]
  currentFilePath?: string
  onRemoveNote: (noteId: string) => void
  onNoteClick?: (note: DiffNote) => void
}

export const CodeReviewNotesList = observer(function CodeReviewNotesList({
  notes,
  currentFilePath,
  onRemoveNote,
  onNoteClick,
}: CodeReviewNotesListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <div className="text-sm text-ovr-text-muted">No comments yet</div>
        <div className="mt-1 text-xs text-ovr-text-dim">
          Select lines in the diff to add comments
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {notes.map((note) => {
        const fileName = note.filePath.split("/").pop() ?? note.filePath
        const lineRef =
          note.startLine === note.endLine
            ? `Line ${note.startLine}`
            : `Lines ${note.startLine}-${note.endLine}`
        const isCurrentFile = currentFilePath === note.filePath

        return (
          <div
            key={note.id}
            data-testid="review-note"
            className={`group relative rounded border border-ovr-border-subtle bg-ovr-bg-app p-2 ${onNoteClick ? "cursor-pointer hover:border-ovr-azure-500/50 hover:bg-ovr-azure-500/5" : ""} ${isCurrentFile ? "border-l-2 border-l-ovr-azure-500" : ""}`}
            onClick={() => onNoteClick?.(note)}
            role={onNoteClick ? "button" : undefined}
            tabIndex={onNoteClick ? 0 : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 truncate font-mono text-xs text-ovr-text-secondary">
                  {fileName}
                </div>
                <div className="mb-1 text-xs text-ovr-text-dim">{lineRef}</div>
                <div className="text-xs text-ovr-text-primary">{note.comment}</div>
              </div>
              <button
                data-testid="remove-note-button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveNote(note.id)
                }}
                className="shrink-0 rounded p-0.5 text-ovr-text-dim opacity-0 transition-opacity hover:bg-ovr-bg-elevated hover:text-ovr-text-primary group-hover:opacity-100"
                title="Remove comment"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
})
