import { observable, computed, action, makeObservable } from "mobx"

export interface PlanReviewNote {
  id: string
  startLine: number // 1-based
  endLine: number // 1-based
  lineContent: string // The selected lines as plain text
  comment: string
  createdAt: number
}

export interface PendingPlanNote {
  anchorIndex: number // 0-based index into lines array
  focusIndex: number // 0-based index into lines array
  commentText: string
  editingNoteId?: string // If set, we're editing an existing note
}

/**
 * Manages plan review state for the PlanReviewDialog.
 * Collects multiple notes before submitting them as a batch.
 */
export type PlanViewMode = "code" | "markdown"

export class PlanReviewStore {
  @observable.deep
  pending: PendingPlanNote | null = null

  @observable
  notes: PlanReviewNote[] = []

  @observable
  showDiscardDialog = false

  @observable
  viewMode: PlanViewMode = "markdown"

  @observable
  highlightedLine: number | null = null

  constructor() {
    makeObservable(this)
  }

  @action
  setViewMode(mode: PlanViewMode) {
    this.viewMode = mode
  }

  @action
  switchToCodeAtLine(lineIndex: number) {
    this.viewMode = "code"
    this.highlightedLine = lineIndex
    // Don't start selection - just highlight the line
  }

  @action
  clearHighlight() {
    this.highlightedLine = null
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
  get hasNotes(): boolean {
    return this.notes.length > 0
  }

  @computed
  get isEditing(): boolean {
    return this.pending?.editingNoteId !== undefined
  }

  /**
   * Returns a Set of line indices (0-based) that have notes on them.
   */
  @computed
  get linesWithNotes(): Set<number> {
    const lines = new Set<number>()
    for (const note of this.notes) {
      for (let i = note.startLine - 1; i < note.endLine; i++) {
        lines.add(i)
      }
    }
    return lines
  }

  @action
  startSelection(lineIndex: number, shiftKey: boolean) {
    // Clear any highlight from double-click navigation
    this.highlightedLine = null

    if (shiftKey && this.pending) {
      // Extend existing selection
      this.pending.focusIndex = lineIndex
    } else {
      // Start new selection
      this.pending = {
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
  addNote(lineContent: string, startLine: number, endLine: number) {
    if (!this.pending || !this.pending.commentText.trim()) return

    const editingId = this.pending.editingNoteId

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
      // Create new note
      const note: PlanReviewNote = {
        id: crypto.randomUUID(),
        startLine,
        endLine,
        lineContent,
        comment: this.pending.commentText.trim(),
        createdAt: Date.now(),
      }
      this.notes.push(note)
    }

    this.pending = null
    this.showDiscardDialog = false
  }

  @action
  editNote(note: PlanReviewNote) {
    // Convert 1-based line numbers to 0-based indices
    this.pending = {
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
  discardPending() {
    this.pending = null
    this.showDiscardDialog = false
  }

  @action
  requestDiscard(): boolean {
    if (this.hasUnsavedComment) {
      this.showDiscardDialog = true
      return true
    }
    this.discardPending()
    return false
  }

  @action
  cancelDiscard() {
    this.showDiscardDialog = false
  }

  @action
  reset() {
    this.pending = null
    this.notes = []
    this.showDiscardDialog = false
    this.viewMode = "markdown"
    this.highlightedLine = null
  }

  /**
   * Formats all collected notes into a single message for the agent.
   */
  formatReviewMessage(planContent: string): string {
    if (this.notes.length === 0) return ""

    const lines = planContent.split("\n")
    const parts: string[] = ["User review comments on the proposed plan:\n"]

    // Sort notes by line number
    const sortedNotes = [...this.notes].sort((a, b) => a.startLine - b.startLine)

    for (const note of sortedNotes) {
      const lineRef =
        note.startLine === note.endLine
          ? `Line ${note.startLine}`
          : `Lines ${note.startLine}-${note.endLine}`

      // Quote the selected content
      const selectedLines = lines.slice(note.startLine - 1, note.endLine)
      const quoted = selectedLines.map((l) => `> ${l}`).join("\n")

      parts.push(`## ${lineRef}`)
      parts.push(quoted)
      parts.push("") // blank line
      parts.push(note.comment)
      parts.push("") // blank line
    }

    parts.push("---")
    parts.push("Please revise the plan based on the feedback above.")

    return parts.join("\n")
  }
}

export function createPlanReviewStore(): PlanReviewStore {
  return new PlanReviewStore()
}
