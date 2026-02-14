import { describe, it, expect, beforeEach, vi } from "vitest"
import { DiffNotesStore, createDiffNotesStore } from "../DiffNotesStore"

describe("DiffNotesStore", () => {
  let store: DiffNotesStore

  beforeEach(() => {
    store = new DiffNotesStore()
  })

  describe("initial state", () => {
    it("has no pending note", () => {
      expect(store.pending).toBeNull()
      expect(store.hasPendingNote).toBe(false)
    })

    it("has no notes", () => {
      expect(store.notes).toEqual([])
      expect(store.hasReviewNotes).toBe(false)
    })

    it("has selection values as null", () => {
      expect(store.selectionStart).toBeNull()
      expect(store.selectionEnd).toBeNull()
    })

    it("has showDiscardDialog as false", () => {
      expect(store.showDiscardDialog).toBe(false)
    })

    it("has reviewMode as false", () => {
      expect(store.reviewMode).toBe(false)
    })

    it("has showDiscardReviewDialog as false", () => {
      expect(store.showDiscardReviewDialog).toBe(false)
    })
  })

  describe("startSelection", () => {
    it("creates a new pending note with same anchor and focus", () => {
      store.startSelection("file.ts", 5, false)

      expect(store.pending).toEqual({
        filePath: "file.ts",
        anchorIndex: 5,
        focusIndex: 5,
        commentText: "",
      })
      expect(store.hasPendingNote).toBe(true)
    })

    it("starts a new selection when shift is not pressed", () => {
      store.startSelection("file.ts", 3, false)
      store.startSelection("file.ts", 7, false)

      expect(store.pending?.anchorIndex).toBe(7)
      expect(store.pending?.focusIndex).toBe(7)
    })

    it("extends existing selection when shift is pressed and same file", () => {
      store.startSelection("file.ts", 3, false)
      store.startSelection("file.ts", 7, true)

      expect(store.pending?.anchorIndex).toBe(3)
      expect(store.pending?.focusIndex).toBe(7)
    })

    it("does not extend if different file", () => {
      store.startSelection("file1.ts", 3, false)
      store.startSelection("file2.ts", 7, true)

      expect(store.pending?.filePath).toBe("file2.ts")
      expect(store.pending?.anchorIndex).toBe(7)
      expect(store.pending?.focusIndex).toBe(7)
    })

    it("does not extend if no existing selection", () => {
      store.startSelection("file.ts", 7, true)

      expect(store.pending?.anchorIndex).toBe(7)
      expect(store.pending?.focusIndex).toBe(7)
    })
  })

  describe("extendSelection", () => {
    it("updates focusIndex when pending exists", () => {
      store.startSelection("file.ts", 3, false)
      store.extendSelection(10)

      expect(store.pending?.focusIndex).toBe(10)
      expect(store.pending?.anchorIndex).toBe(3)
    })

    it("does nothing when no pending selection", () => {
      store.extendSelection(10)

      expect(store.pending).toBeNull()
    })
  })

  describe("selectionStart and selectionEnd", () => {
    it("returns min/max of anchor and focus when anchor < focus", () => {
      store.startSelection("file.ts", 3, false)
      store.extendSelection(7)

      expect(store.selectionStart).toBe(3)
      expect(store.selectionEnd).toBe(7)
    })

    it("returns min/max when anchor > focus (dragging up)", () => {
      store.startSelection("file.ts", 10, false)
      store.extendSelection(5)

      expect(store.selectionStart).toBe(5)
      expect(store.selectionEnd).toBe(10)
    })

    it("returns same value when anchor === focus", () => {
      store.startSelection("file.ts", 5, false)

      expect(store.selectionStart).toBe(5)
      expect(store.selectionEnd).toBe(5)
    })
  })

  describe("updateComment", () => {
    it("updates commentText when pending exists", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("This needs work")

      expect(store.pending?.commentText).toBe("This needs work")
    })

    it("does nothing when no pending", () => {
      store.updateComment("This needs work")

      expect(store.pending).toBeNull()
    })
  })

  describe("hasUnsavedComment", () => {
    it("returns false when no pending", () => {
      expect(store.hasUnsavedComment).toBe(false)
    })

    it("returns false when pending has empty comment", () => {
      store.startSelection("file.ts", 0, false)
      expect(store.hasUnsavedComment).toBe(false)
    })

    it("returns false when pending has whitespace-only comment", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("   \n\t  ")
      expect(store.hasUnsavedComment).toBe(false)
    })

    it("returns true when pending has non-empty comment", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Some comment")
      expect(store.hasUnsavedComment).toBe(true)
    })
  })

  describe("reviewMode", () => {
    describe("toggleReviewMode", () => {
      it("toggles reviewMode on", () => {
        store.toggleReviewMode()
        expect(store.reviewMode).toBe(true)
      })

      it("toggles reviewMode off", () => {
        store.reviewMode = true
        store.toggleReviewMode()
        expect(store.reviewMode).toBe(false)
      })
    })

    describe("setReviewMode", () => {
      it("sets reviewMode to true", () => {
        store.setReviewMode(true)
        expect(store.reviewMode).toBe(true)
      })

      it("sets reviewMode to false", () => {
        store.reviewMode = true
        store.setReviewMode(false)
        expect(store.reviewMode).toBe(false)
      })
    })
  })

  describe("submitNote in immediate mode", () => {
    it("calls onSubmitCallback when reviewMode is false", () => {
      const callback = vi.fn()
      store.setOnSubmit(callback)

      store.startSelection("file.ts", 5, false)
      store.updateComment("Fix this")
      store.submitNote("+const x = 1", 6, 6)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: "file.ts",
          startLine: 6,
          endLine: 6,
          lineContent: "+const x = 1",
          comment: "Fix this",
        })
      )
      expect(store.pending).toBeNull()
      expect(store.notes).toHaveLength(0)
    })

    it("does not add to notes array in immediate mode", () => {
      store.startSelection("file.ts", 5, false)
      store.updateComment("Fix this")
      store.submitNote("+const x = 1", 6, 6)

      expect(store.notes).toHaveLength(0)
    })
  })

  describe("submitNote in review mode", () => {
    beforeEach(() => {
      store.setReviewMode(true)
    })

    it("adds note to notes array when reviewMode is true", () => {
      store.startSelection("file.ts", 5, false)
      store.updateComment("Fix this")
      store.submitNote("+const x = 1", 6, 6)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0]).toMatchObject({
        filePath: "file.ts",
        startLine: 6,
        endLine: 6,
        lineContent: "+const x = 1",
        comment: "Fix this",
      })
      expect(store.notes[0].id).toBeDefined()
      expect(store.notes[0].createdAt).toBeDefined()
    })

    it("does not call onSubmitCallback in review mode", () => {
      const callback = vi.fn()
      store.setOnSubmit(callback)

      store.startSelection("file.ts", 5, false)
      store.updateComment("Fix this")
      store.submitNote("+const x = 1", 6, 6)

      expect(callback).not.toHaveBeenCalled()
    })

    it("notes accumulate across multiple submissions", () => {
      store.startSelection("file1.ts", 0, false)
      store.updateComment("First comment")
      store.submitNote("line 1", 1, 1)

      store.startSelection("file2.ts", 5, false)
      store.updateComment("Second comment")
      store.submitNote("line 6", 6, 6)

      expect(store.notes).toHaveLength(2)
      expect(store.hasReviewNotes).toBe(true)
    })

    it("each note gets unique id and timestamp", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("First")
      store.submitNote("code", 1, 1)

      store.startSelection("file.ts", 5, false)
      store.updateComment("Second")
      store.submitNote("code", 6, 6)

      expect(store.notes[0].id).not.toBe(store.notes[1].id)
      expect(store.notes[0].createdAt).toBeDefined()
      expect(store.notes[1].createdAt).toBeDefined()
    })

    it("trims comment text", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("  Fix this  ")
      store.submitNote("code", 1, 1)

      expect(store.notes[0].comment).toBe("Fix this")
    })

    it("does nothing when no pending", () => {
      store.submitNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("does nothing when comment is empty", () => {
      store.startSelection("file.ts", 0, false)
      store.submitNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("does nothing when comment is whitespace only", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("   ")
      store.submitNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("clears pending after submit", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      expect(store.pending).toBeNull()
    })

    it("clears showDiscardDialog", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.showDiscardDialog = true
      store.submitNote("code", 1, 1)

      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("editNote", () => {
    it("loads note into pending with editingNoteId set", () => {
      store.setReviewMode(true)
      store.startSelection("file.ts", 0, false)
      store.updateComment("Original comment")
      store.submitNote("code", 1, 3)

      const note = store.notes[0]
      store.editNote(note)

      expect(store.pending).toEqual({
        filePath: "file.ts",
        anchorIndex: 0, // startLine 1 - 1
        focusIndex: 2, // endLine 3 - 1
        commentText: "Original comment",
        editingNoteId: note.id,
      })
    })

    it("isEditing returns true when editingNoteId present", () => {
      store.setReviewMode(true)
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      store.editNote(store.notes[0])
      expect(store.isEditing).toBe(true)
    })
  })

  describe("submitNote updates existing note when editing", () => {
    beforeEach(() => {
      store.setReviewMode(true)
    })

    it("updates existing note when editingNoteId matches", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Original comment")
      store.submitNote("code", 1, 1)

      const noteId = store.notes[0].id
      const createdAt = store.notes[0].createdAt

      store.editNote(store.notes[0])
      store.updateComment("Updated comment")
      store.extendSelection(2) // Extend selection
      store.submitNote("new code", 1, 3)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].id).toBe(noteId)
      expect(store.notes[0].comment).toBe("Updated comment")
      expect(store.notes[0].startLine).toBe(1)
      expect(store.notes[0].endLine).toBe(3)
      expect(store.notes[0].createdAt).toBe(createdAt) // Preserved
    })

    it("preserves id when updating", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      const originalId = store.notes[0].id

      store.editNote(store.notes[0])
      store.updateComment("New comment")
      store.submitNote("code", 1, 1)

      expect(store.notes[0].id).toBe(originalId)
    })
  })

  describe("isEditing", () => {
    it("returns false when not editing", () => {
      store.startSelection("file.ts", 0, false)
      expect(store.isEditing).toBe(false)
    })

    it("returns false when pending is null", () => {
      expect(store.isEditing).toBe(false)
    })
  })

  describe("removeNote", () => {
    beforeEach(() => {
      store.setReviewMode(true)
    })

    it("removes note by id", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment 1")
      store.submitNote("code1", 1, 1)

      store.startSelection("file.ts", 5, false)
      store.updateComment("Comment 2")
      store.submitNote("code2", 6, 6)

      const noteId = store.notes[0].id
      store.removeNote(noteId)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].comment).toBe("Comment 2")
    })

    it("does nothing if note id not found (no-op)", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      store.removeNote("nonexistent-id")

      expect(store.notes).toHaveLength(1)
    })
  })

  describe("linesWithNotes", () => {
    beforeEach(() => {
      store.setReviewMode(true)
    })

    it("returns empty Map when no notes", () => {
      expect(store.linesWithNotes.size).toBe(0)
    })

    it("returns Map with filePath and line indices for single-line note", () => {
      store.startSelection("file.ts", 2, false)
      store.updateComment("Comment")
      store.submitNote("code", 3, 3) // Line 3 = index 2

      const lines = store.linesWithNotes.get("file.ts")
      expect(lines).toBeDefined()
      expect(lines!.has(2)).toBe(true)
      expect(lines!.size).toBe(1)
    })

    it("returns correct line indices for multi-line note", () => {
      store.startSelection("file.ts", 1, false)
      store.extendSelection(3)
      store.updateComment("Comment")
      store.submitNote("code", 2, 4) // Lines 2-4 = indices 1,2,3

      const lines = store.linesWithNotes.get("file.ts")
      expect(lines!.has(1)).toBe(true)
      expect(lines!.has(2)).toBe(true)
      expect(lines!.has(3)).toBe(true)
      expect(lines!.size).toBe(3)
    })

    it("combines line indices from multiple notes in same file", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment 1")
      store.submitNote("code", 1, 1) // Line 1 = index 0

      store.startSelection("file.ts", 4, false)
      store.updateComment("Comment 2")
      store.submitNote("code", 5, 5) // Line 5 = index 4

      const lines = store.linesWithNotes.get("file.ts")
      expect(lines!.has(0)).toBe(true)
      expect(lines!.has(4)).toBe(true)
      expect(lines!.size).toBe(2)
    })

    it("handles notes across multiple files", () => {
      store.startSelection("file1.ts", 0, false)
      store.updateComment("Comment 1")
      store.submitNote("code", 1, 1)

      store.startSelection("file2.ts", 5, false)
      store.updateComment("Comment 2")
      store.submitNote("code", 6, 6)

      expect(store.linesWithNotes.has("file1.ts")).toBe(true)
      expect(store.linesWithNotes.has("file2.ts")).toBe(true)
      expect(store.linesWithNotes.get("file1.ts")!.has(0)).toBe(true)
      expect(store.linesWithNotes.get("file2.ts")!.has(5)).toBe(true)
    })

    it("updates when notes array changes", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      expect(store.linesWithNotes.get("file.ts")!.has(0)).toBe(true)

      store.removeNote(store.notes[0].id)

      expect(store.linesWithNotes.size).toBe(0)
    })
  })

  describe("hasReviewNotes", () => {
    it("returns false when notes array is empty", () => {
      expect(store.hasReviewNotes).toBe(false)
    })

    it("returns true when notes array has items", () => {
      store.setReviewMode(true)
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      expect(store.hasReviewNotes).toBe(true)
    })
  })

  describe("discardPending", () => {
    it("clears pending and showDiscardDialog", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Some text")
      store.showDiscardDialog = true

      store.discardPending()

      expect(store.pending).toBeNull()
      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("requestDiscard", () => {
    it("returns false and discards when no unsaved comment", () => {
      store.startSelection("file.ts", 0, false)

      const result = store.requestDiscard()

      expect(result).toBe(false)
      expect(store.pending).toBeNull()
    })

    it("returns true and shows dialog when has unsaved comment", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Unsaved text")

      const result = store.requestDiscard()

      expect(result).toBe(true)
      expect(store.showDiscardDialog).toBe(true)
      expect(store.pending).not.toBeNull()
    })
  })

  describe("cancelDiscard", () => {
    it("sets showDiscardDialog to false", () => {
      store.showDiscardDialog = true

      store.cancelDiscard()

      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("review mode warning dialogs", () => {
    describe("requestDiscardReview", () => {
      it("shows dialog if hasReviewNotes", () => {
        store.setReviewMode(true)
        store.startSelection("file.ts", 0, false)
        store.updateComment("Comment")
        store.submitNote("code", 1, 1)

        const result = store.requestDiscardReview()

        expect(result).toBe(true)
        expect(store.showDiscardReviewDialog).toBe(true)
      })

      it("clears review if no notes", () => {
        store.setReviewMode(true)

        const result = store.requestDiscardReview()

        expect(result).toBe(false)
        expect(store.showDiscardReviewDialog).toBe(false)
        expect(store.reviewMode).toBe(false)
      })
    })

    describe("cancelDiscardReview", () => {
      it("hides dialog", () => {
        store.showDiscardReviewDialog = true

        store.cancelDiscardReview()

        expect(store.showDiscardReviewDialog).toBe(false)
      })
    })

    describe("confirmDiscardReview", () => {
      it("clears all review state", () => {
        store.setReviewMode(true)
        store.startSelection("file.ts", 0, false)
        store.updateComment("Comment")
        store.submitNote("code", 1, 1)
        store.showDiscardReviewDialog = true

        store.confirmDiscardReview()

        expect(store.showDiscardReviewDialog).toBe(false)
        expect(store.notes).toHaveLength(0)
        expect(store.pending).toBeNull()
        expect(store.reviewMode).toBe(false)
      })
    })
  })

  describe("clearReview", () => {
    it("clears notes, pending, and reviewMode", () => {
      store.setReviewMode(true)
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)
      store.startSelection("file.ts", 5, false)

      store.clearReview()

      expect(store.notes).toHaveLength(0)
      expect(store.pending).toBeNull()
      expect(store.reviewMode).toBe(false)
    })
  })

  describe("reset", () => {
    it("clears all state including reviewMode", () => {
      store.setReviewMode(true)
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)
      store.startSelection("file.ts", 5, false)
      store.showDiscardDialog = true
      store.showDiscardReviewDialog = true

      store.reset()

      expect(store.pending).toBeNull()
      expect(store.notes).toEqual([])
      expect(store.showDiscardDialog).toBe(false)
      expect(store.showDiscardReviewDialog).toBe(false)
      expect(store.reviewMode).toBe(false)
    })
  })

  describe("formatReviewMessage", () => {
    beforeEach(() => {
      store.setReviewMode(true)
    })

    it("returns empty string when no notes", () => {
      expect(store.formatReviewMessage()).toBe("")
    })

    it("formats a single note on one line", () => {
      store.startSelection("src/file.ts", 1, false)
      store.updateComment("This line needs work")
      store.submitNote("+const x = 1", 2, 2)

      const message = store.formatReviewMessage()

      expect(message).toContain("User review comments on the code changes:")
      expect(message).toContain("## src/file.ts")
      expect(message).toContain("### Line 2")
      expect(message).toContain("```")
      expect(message).toContain("+const x = 1")
      expect(message).toContain("This line needs work")
      expect(message).toContain("Please address the feedback above.")
    })

    it("formats a single note spanning multiple lines", () => {
      store.startSelection("file.ts", 1, false)
      store.extendSelection(3)
      store.updateComment("These lines need work")
      store.submitNote("+line 2\n+line 3\n+line 4", 2, 4)

      const message = store.formatReviewMessage()

      expect(message).toContain("### Lines 2-4")
    })

    it("groups notes by file path", () => {
      store.startSelection("file1.ts", 0, false)
      store.updateComment("Comment on file1")
      store.submitNote("code1", 1, 1)

      store.startSelection("file2.ts", 5, false)
      store.updateComment("Comment on file2")
      store.submitNote("code2", 6, 6)

      const message = store.formatReviewMessage()

      expect(message).toContain("## file1.ts")
      expect(message).toContain("## file2.ts")
    })

    it("sorts notes by line number within each file", () => {
      // Add note on line 5 first
      store.startSelection("file.ts", 4, false)
      store.updateComment("Second comment")
      store.submitNote("line 5", 5, 5)

      // Add note on line 2 second
      store.startSelection("file.ts", 1, false)
      store.updateComment("First comment")
      store.submitNote("line 2", 2, 2)

      const message = store.formatReviewMessage()

      // Line 2 should come before Line 5
      const line2Index = message.indexOf("### Line 2")
      const line5Index = message.indexOf("### Line 5")
      expect(line2Index).toBeLessThan(line5Index)
    })

    it("sorts files alphabetically", () => {
      store.startSelection("z-file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      store.startSelection("a-file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      const message = store.formatReviewMessage()

      const aFileIndex = message.indexOf("## a-file.ts")
      const zFileIndex = message.indexOf("## z-file.ts")
      expect(aFileIndex).toBeLessThan(zFileIndex)
    })

    it("includes diff snippet in code block", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("+const x = 1\n-const y = 2", 1, 2)

      const message = store.formatReviewMessage()

      expect(message).toContain("```")
      expect(message).toContain("+const x = 1")
      expect(message).toContain("-const y = 2")
    })

    it("ends with request to address feedback", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Comment")
      store.submitNote("code", 1, 1)

      const message = store.formatReviewMessage()

      expect(message).toContain("---")
      expect(message).toContain("Please address the feedback above.")
    })
  })

  describe("canSwitchFile", () => {
    it("returns true when no unsaved comment", () => {
      expect(store.canSwitchFile()).toBe(true)
    })

    it("returns true when pending has empty comment", () => {
      store.startSelection("file.ts", 0, false)
      expect(store.canSwitchFile()).toBe(true)
    })

    it("returns false when pending has unsaved comment", () => {
      store.startSelection("file.ts", 0, false)
      store.updateComment("Some text")
      expect(store.canSwitchFile()).toBe(false)
    })
  })

  describe("createDiffNotesStore factory", () => {
    it("creates a new DiffNotesStore instance", () => {
      const store = createDiffNotesStore()

      expect(store).toBeInstanceOf(DiffNotesStore)
      expect(store.notes).toEqual([])
      expect(store.pending).toBeNull()
      expect(store.reviewMode).toBe(false)
    })
  })
})
