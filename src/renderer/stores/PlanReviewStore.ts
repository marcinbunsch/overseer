import { observable, computed, action, makeObservable } from "mobx"
import type { DomMeta } from "@plannotator/web-highlighter/dist/types"

/**
 * web-highlighter serialization for a preview note, so its exact-text highlight can be
 * repainted and removed by id. Absent on diff-view notes (which are line-anchored).
 */
export interface TextAnchor {
  startMeta: DomMeta
  endMeta: DomMeta
}

export interface PlanReviewNote {
  id: string
  startLine: number // 1-based
  endLine: number // 1-based
  lineContent: string // The selected lines as plain text
  comment: string
  createdAt: number
  /**
   * The exact rendered text the user selected in the preview. Set for preview notes,
   * undefined for diff-view notes (which are anchored to whole source lines). When
   * present, formatReviewMessage quotes this instead of the raw source lines.
   */
  selectedText?: string
  /** web-highlighter anchor for preview notes; undefined for diff-view notes. */
  anchor?: TextAnchor
}

export interface PendingPlanNote {
  filePath: string // Static "plan.md" for pierre/diff compatibility
  anchorIndex: number // 0-based index into lines array
  focusIndex: number // 0-based index into lines array
  commentText: string
  editingNoteId?: string // If set, we're editing an existing note
  /** Exact rendered text selected in the preview; undefined for diff-view selections. */
  selectedText?: string
}

/**
 * Manages plan review state for the PlanReviewDialog.
 * Collects multiple notes before submitting them as a batch.
 */
export type PlanViewMode = "diff" | "markdown"

/** Static file path for pierre/diff compatibility */
export const PLAN_FILE_PATH = "plan.md"

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
  switchToDiffAtLine(lineIndex: number) {
    this.viewMode = "diff"
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

  /**
   * Adds a preview note anchored to an exact text selection (from web-highlighter). The
   * highlight itself lives in the DOM; the note stores the serialized anchor so it can be
   * repainted and removed by id. Line numbers are derived from the highlighted blocks so
   * preview notes sort and label alongside the diff-view notes.
   */
  @action
  addPreviewNote(note: {
    id: string
    startLine: number
    endLine: number
    selectedText: string
    comment: string
    anchor: TextAnchor
  }) {
    this.notes.push({
      id: note.id,
      startLine: note.startLine,
      endLine: note.endLine,
      lineContent: note.selectedText,
      comment: note.comment.trim(),
      createdAt: Date.now(),
      selectedText: note.selectedText,
      anchor: note.anchor,
    })
  }

  @action
  startSelection(filePath: string, lineIndex: number, shiftKey: boolean) {
    // Clear any highlight from double-click navigation
    this.highlightedLine = null

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
  addNote(lineContent: string, startLine: number, endLine: number) {
    if (!this.pending || !this.pending.commentText.trim()) return

    const editingId = this.pending.editingNoteId

    const selectedText = this.pending.selectedText

    if (editingId) {
      // Update existing note
      const noteIndex = this.notes.findIndex((n) => n.id === editingId)
      if (noteIndex !== -1) {
        const existing = this.notes[noteIndex]
        if (existing.anchor) {
          // Text-anchored preview note: only the comment is editable. Its line range,
          // snippet and anchor must stay in sync with the painted highlight, so a
          // diff-view line selection must not overwrite them.
          this.notes[noteIndex] = { ...existing, comment: this.pending.commentText.trim() }
        } else {
          this.notes[noteIndex] = {
            ...existing,
            startLine,
            endLine,
            lineContent,
            comment: this.pending.commentText.trim(),
            selectedText,
          }
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
        selectedText,
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
      filePath: PLAN_FILE_PATH,
      anchorIndex: note.startLine - 1,
      focusIndex: note.endLine - 1,
      commentText: note.comment,
      editingNoteId: note.id,
      selectedText: note.selectedText,
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

      // Quote the selected content. Preview notes quote the exact highlighted text;
      // diff-view notes fall back to the whole source lines they cover.
      const quotedSource =
        note.selectedText ?? lines.slice(note.startLine - 1, note.endLine).join("\n")
      const quoted = quotedSource
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")

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
