import { observer } from "mobx-react-lite"
import { X } from "lucide-react"
import type { PlanReviewNote } from "../../stores/PlanReviewStore"

interface PlanReviewNotesListProps {
  notes: PlanReviewNote[]
  onRemoveNote: (noteId: string) => void
  onNoteClick?: (note: PlanReviewNote) => void
}

export const PlanReviewNotesList = observer(function PlanReviewNotesList({
  notes,
  onRemoveNote,
  onNoteClick,
}: PlanReviewNotesListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <div className="text-sm text-ovr-text-muted">No comments yet</div>
        <div className="mt-1 text-xs text-ovr-text-dim">
          Select lines in the plan to add comments
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {notes.map((note) => {
        const lineRef =
          note.startLine === note.endLine
            ? `Line ${note.startLine}`
            : `Lines ${note.startLine}-${note.endLine}`

        return (
          <div
            key={note.id}
            className={`group relative rounded border border-ovr-border-subtle bg-ovr-bg-app p-2 ${onNoteClick ? "cursor-pointer hover:border-ovr-azure-500/50 hover:bg-ovr-azure-500/5" : ""}`}
            onClick={() => onNoteClick?.(note)}
            role={onNoteClick ? "button" : undefined}
            tabIndex={onNoteClick ? 0 : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-medium text-ovr-text-secondary">{lineRef}</div>
                <div className="text-xs text-ovr-text-primary">{note.comment}</div>
              </div>
              <button
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
