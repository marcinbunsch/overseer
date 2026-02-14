import { observable, computed, action, makeObservable } from "mobx"

export interface DiffNote {
  id: string
  filePath: string
  startLine: number
  endLine: number
  lineContent: string // The diff snippet for context
  comment: string
  createdAt: number
}

export interface PendingNote {
  filePath: string
  anchorIndex: number
  focusIndex: number
  commentText: string
  editingNoteId?: string // If set, we're editing an existing note
}

/**
 * Manages diff notes/comments for the diff dialog.
 * Supports both immediate "send to chat" mode and "review mode"
 * where multiple notes can be collected and sent as a batch.
 */
export class DiffNotesStore {
  // Current pending note being edited (not yet submitted)
  // Use observable.deep to track mutations to properties within the object
  @observable.deep
  pending: PendingNote | null = null

  // Collected notes for review mode
  @observable
  notes: DiffNote[] = []

  // Whether discard confirmation dialog is open
  @observable
  showDiscardDialog = false

  // Whether review mode is enabled (collect notes vs immediate send)
  @observable
  reviewMode = false

  // Whether discard review confirmation dialog is open
  @observable
  showDiscardReviewDialog = false

  constructor() {
    makeObservable(this)
  }

  // Callback when a note is submitted (for immediate send-to-chat mode)
  private onSubmitCallback: ((note: DiffNote) => void) | null = null

  @action
  setOnSubmit(callback: (note: DiffNote) => void) {
    this.onSubmitCallback = callback
  }

  @computed
  get hasPendingNote(): boolean {
    return this.pending !== null
  }

  @computed
  get hasUnsavedComment(): boolean {
    return this.pending !== null && this.pending.commentText.trim().length > 0
  }

  @computed
  get selectionStart(): number | null {
    if (!this.pending) return null
    return Math.min(this.pending.anchorIndex, this.pending.focusIndex)
  }

  @computed
  get selectionEnd(): number | null {
    if (!this.pending) return null
    return Math.max(this.pending.anchorIndex, this.pending.focusIndex)
  }

  @computed
  get hasReviewNotes(): boolean {
    return this.notes.length > 0
  }

  @computed
  get isEditing(): boolean {
    return this.pending?.editingNoteId !== undefined
  }

  /**
   * Returns a Map of filePath -> Set of line indices (0-based) that have notes.
   */
  @computed
  get linesWithNotes(): Map<string, Set<number>> {
    const result = new Map<string, Set<number>>()
    for (const note of this.notes) {
      let lines = result.get(note.filePath)
      if (!lines) {
        lines = new Set<number>()
        result.set(note.filePath, lines)
      }
      // Convert 1-based line numbers to 0-based indices
      for (let i = note.startLine - 1; i < note.endLine; i++) {
        lines.add(i)
      }
    }
    return result
  }

  @action
  startSelection(filePath: string, lineIndex: number, shiftKey: boolean) {
    if (shiftKey && this.pending && this.pending.filePath === filePath) {
      // Extend existing selection
      this.pending.focusIndex = lineIndex
    } else {
      // Start new selection
      this.pending = {
        filePath,
        anchorIndex: lineIndex,
        focusIndex: lineIndex,
        commentText: "",
      }
    }
  }

  @action
  extendSelection(lineIndex: number) {
    if (!this.pending) return
    this.pending.focusIndex = lineIndex
  }

  @action
  updateComment(text: string) {
    if (!this.pending) return
    this.pending.commentText = text
  }

  @action
  submitNote(lineContent: string, startLine: number, endLine: number) {
    if (!this.pending || !this.pending.commentText.trim()) return

    const editingId = this.pending.editingNoteId

    if (this.reviewMode) {
      if (editingId) {
        // Update existing note
        const noteIndex = this.notes.findIndex((n) => n.id === editingId)
        if (noteIndex !== -1) {
          this.notes[noteIndex] = {
            ...this.notes[noteIndex],
            startLine,
            endLine,
            lineContent,
            comment: this.pending.commentText.trim(),
          }
        }
      } else {
        // Add new note to collection
        const note: DiffNote = {
          id: crypto.randomUUID(),
          filePath: this.pending.filePath,
          startLine,
          endLine,
          lineContent,
          comment: this.pending.commentText.trim(),
          createdAt: Date.now(),
        }
        this.notes.push(note)
      }
    } else {
      // Immediate send mode - invoke callback
      const note: DiffNote = {
        id: crypto.randomUUID(),
        filePath: this.pending.filePath,
        startLine,
        endLine,
        lineContent,
        comment: this.pending.commentText.trim(),
        createdAt: Date.now(),
      }
      if (this.onSubmitCallback) {
        this.onSubmitCallback(note)
      }
    }
    this.pending = null
    this.showDiscardDialog = false
  }

  @action
  editNote(note: DiffNote) {
    // Load existing note into pending for editing
    // Note: startLine/endLine are 1-based, anchorIndex/focusIndex are 0-based
    this.pending = {
      filePath: note.filePath,
      anchorIndex: note.startLine - 1,
      focusIndex: note.endLine - 1,
      commentText: note.comment,
      editingNoteId: note.id,
    }
  }

  @action
  removeNote(noteId: string) {
    this.notes = this.notes.filter((n) => n.id !== noteId)
  }

  @action
  toggleReviewMode() {
    this.reviewMode = !this.reviewMode
  }

  @action
  setReviewMode(enabled: boolean) {
    this.reviewMode = enabled
  }

  @action
  discardPending() {
    this.pending = null
    this.showDiscardDialog = false
  }

  @action
  clearSelection() {
    this.pending = null
    this.showDiscardDialog = false
  }

  @action
  requestDiscard() {
    if (this.hasUnsavedComment) {
      this.showDiscardDialog = true
      return true // Indicates discard dialog was shown
    }
    this.discardPending()
    return false
  }

  @action
  cancelDiscard() {
    this.showDiscardDialog = false
  }

  @action
  requestDiscardReview(): boolean {
    if (this.hasReviewNotes) {
      this.showDiscardReviewDialog = true
      return true
    }
    this.clearReview()
    return false
  }

  @action
  cancelDiscardReview() {
    this.showDiscardReviewDialog = false
  }

  @action
  confirmDiscardReview() {
    this.showDiscardReviewDialog = false
    this.clearReview()
  }

  @action
  clearReview() {
    this.notes = []
    this.pending = null
    this.reviewMode = false
  }

  // Reset store when dialog closes
  @action
  reset() {
    this.pending = null
    this.notes = []
    this.showDiscardDialog = false
    this.showDiscardReviewDialog = false
    this.reviewMode = false
  }

  /**
   * Formats all collected notes into a single message for the agent.
   */
  formatReviewMessage(): string {
    if (this.notes.length === 0) return ""

    const parts: string[] = ["User review comments on the code changes:\n"]

    // Group notes by file
    const notesByFile = new Map<string, DiffNote[]>()
    for (const note of this.notes) {
      const fileNotes = notesByFile.get(note.filePath) ?? []
      fileNotes.push(note)
      notesByFile.set(note.filePath, fileNotes)
    }

    // Sort files and notes within each file
    const sortedFiles = [...notesByFile.keys()].sort()
    for (const filePath of sortedFiles) {
      const fileNotes = notesByFile.get(filePath)!
      const sortedNotes = [...fileNotes].sort((a, b) => a.startLine - b.startLine)

      parts.push(`## ${filePath}`)
      parts.push("")

      for (const note of sortedNotes) {
        const lineRef =
          note.startLine === note.endLine
            ? `Line ${note.startLine}`
            : `Lines ${note.startLine}-${note.endLine}`

        parts.push(`### ${lineRef}`)
        parts.push("```")
        parts.push(note.lineContent)
        parts.push("```")
        parts.push("")
        parts.push(note.comment)
        parts.push("")
      }
    }

    parts.push("---")
    parts.push("Please address the feedback above.")

    return parts.join("\n")
  }

  // For file switching - check if we need confirmation
  canSwitchFile(): boolean {
    return !this.hasUnsavedComment
  }
}

// Factory function to create a new store instance per dialog
export function createDiffNotesStore(): DiffNotesStore {
  return new DiffNotesStore()
}
