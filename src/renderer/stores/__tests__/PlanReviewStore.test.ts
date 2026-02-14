import { describe, it, expect, beforeEach } from "vitest"
import { PlanReviewStore, createPlanReviewStore } from "../PlanReviewStore"

describe("PlanReviewStore", () => {
  let store: PlanReviewStore

  beforeEach(() => {
    store = new PlanReviewStore()
  })

  describe("initial state", () => {
    it("has no pending note", () => {
      expect(store.pending).toBeNull()
      expect(store.hasPendingNote).toBe(false)
    })

    it("has no notes", () => {
      expect(store.notes).toEqual([])
      expect(store.hasNotes).toBe(false)
    })

    it("has selection values as null", () => {
      expect(store.selectionStart).toBeNull()
      expect(store.selectionEnd).toBeNull()
    })

    it("has showDiscardDialog as false", () => {
      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("startSelection", () => {
    it("creates a new pending note with same anchor and focus", () => {
      store.startSelection(5, false)

      expect(store.pending).toEqual({
        anchorIndex: 5,
        focusIndex: 5,
        commentText: "",
      })
      expect(store.hasPendingNote).toBe(true)
    })

    it("starts a new selection when shift is not pressed", () => {
      store.startSelection(3, false)
      store.startSelection(7, false)

      expect(store.pending?.anchorIndex).toBe(7)
      expect(store.pending?.focusIndex).toBe(7)
    })

    it("extends existing selection when shift is pressed", () => {
      store.startSelection(3, false)
      store.startSelection(7, true)

      expect(store.pending?.anchorIndex).toBe(3)
      expect(store.pending?.focusIndex).toBe(7)
    })

    it("does not extend if no existing selection", () => {
      store.startSelection(7, true)

      expect(store.pending?.anchorIndex).toBe(7)
      expect(store.pending?.focusIndex).toBe(7)
    })
  })

  describe("extendSelection", () => {
    it("updates focusIndex when pending exists", () => {
      store.startSelection(3, false)
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
      store.startSelection(3, false)
      store.extendSelection(7)

      expect(store.selectionStart).toBe(3)
      expect(store.selectionEnd).toBe(7)
    })

    it("returns min/max when anchor > focus (dragging up)", () => {
      store.startSelection(10, false)
      store.extendSelection(5)

      expect(store.selectionStart).toBe(5)
      expect(store.selectionEnd).toBe(10)
    })

    it("returns same value when anchor === focus", () => {
      store.startSelection(5, false)

      expect(store.selectionStart).toBe(5)
      expect(store.selectionEnd).toBe(5)
    })
  })

  describe("updateComment", () => {
    it("updates commentText when pending exists", () => {
      store.startSelection(0, false)
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
      store.startSelection(0, false)
      expect(store.hasUnsavedComment).toBe(false)
    })

    it("returns false when pending has whitespace-only comment", () => {
      store.startSelection(0, false)
      store.updateComment("   \n\t  ")
      expect(store.hasUnsavedComment).toBe(false)
    })

    it("returns true when pending has non-empty comment", () => {
      store.startSelection(0, false)
      store.updateComment("Some comment")
      expect(store.hasUnsavedComment).toBe(true)
    })
  })

  describe("addNote", () => {
    it("adds note to notes array and clears pending", () => {
      store.startSelection(5, false)
      store.updateComment("Fix this issue")
      store.addNote("const x = 1", 6, 6)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0]).toMatchObject({
        startLine: 6,
        endLine: 6,
        lineContent: "const x = 1",
        comment: "Fix this issue",
      })
      expect(store.notes[0].id).toBeDefined()
      expect(store.notes[0].createdAt).toBeDefined()
      expect(store.pending).toBeNull()
    })

    it("trims comment text", () => {
      store.startSelection(0, false)
      store.updateComment("  Fix this  ")
      store.addNote("code", 1, 1)

      expect(store.notes[0].comment).toBe("Fix this")
    })

    it("does nothing when no pending", () => {
      store.addNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("does nothing when comment is empty", () => {
      store.startSelection(0, false)
      store.addNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("does nothing when comment is whitespace only", () => {
      store.startSelection(0, false)
      store.updateComment("   ")
      store.addNote("code", 1, 1)
      expect(store.notes).toHaveLength(0)
    })

    it("allows adding multiple notes", () => {
      store.startSelection(0, false)
      store.updateComment("First comment")
      store.addNote("line 1", 1, 1)

      store.startSelection(5, false)
      store.updateComment("Second comment")
      store.addNote("line 6", 6, 6)

      expect(store.notes).toHaveLength(2)
      expect(store.hasNotes).toBe(true)
    })

    it("clears showDiscardDialog", () => {
      store.startSelection(0, false)
      store.updateComment("Comment")
      store.showDiscardDialog = true
      store.addNote("code", 1, 1)

      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("editNote", () => {
    it("sets pending with note data and editingNoteId", () => {
      store.startSelection(0, false)
      store.updateComment("Original comment")
      store.addNote("code", 1, 3)

      const note = store.notes[0]
      store.editNote(note)

      expect(store.pending).toEqual({
        anchorIndex: 0, // startLine 1 - 1
        focusIndex: 2, // endLine 3 - 1
        commentText: "Original comment",
        editingNoteId: note.id,
      })
      expect(store.isEditing).toBe(true)
    })
  })

  describe("addNote with editing", () => {
    it("updates existing note when editingNoteId is set", () => {
      store.startSelection(0, false)
      store.updateComment("Original comment")
      store.addNote("code", 1, 1)

      const noteId = store.notes[0].id
      const createdAt = store.notes[0].createdAt

      store.editNote(store.notes[0])
      store.updateComment("Updated comment")
      store.extendSelection(2) // Extend selection
      store.addNote("new code", 1, 3)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].id).toBe(noteId)
      expect(store.notes[0].comment).toBe("Updated comment")
      expect(store.notes[0].startLine).toBe(1)
      expect(store.notes[0].endLine).toBe(3)
      expect(store.notes[0].createdAt).toBe(createdAt) // Preserved
    })
  })

  describe("isEditing", () => {
    it("returns false when not editing", () => {
      store.startSelection(0, false)
      expect(store.isEditing).toBe(false)
    })

    it("returns true when editing a note", () => {
      store.startSelection(0, false)
      store.updateComment("Comment")
      store.addNote("code", 1, 1)

      store.editNote(store.notes[0])
      expect(store.isEditing).toBe(true)
    })
  })

  describe("linesWithNotes", () => {
    it("returns empty set when no notes", () => {
      expect(store.linesWithNotes.size).toBe(0)
    })

    it("returns correct line indices for single-line note", () => {
      store.startSelection(2, false)
      store.updateComment("Comment")
      store.addNote("code", 3, 3) // Line 3 = index 2

      expect(store.linesWithNotes.has(2)).toBe(true)
      expect(store.linesWithNotes.size).toBe(1)
    })

    it("returns correct line indices for multi-line note", () => {
      store.startSelection(1, false)
      store.extendSelection(3)
      store.updateComment("Comment")
      store.addNote("code", 2, 4) // Lines 2-4 = indices 1,2,3

      expect(store.linesWithNotes.has(1)).toBe(true)
      expect(store.linesWithNotes.has(2)).toBe(true)
      expect(store.linesWithNotes.has(3)).toBe(true)
      expect(store.linesWithNotes.size).toBe(3)
    })

    it("combines line indices from multiple notes", () => {
      store.startSelection(0, false)
      store.updateComment("Comment 1")
      store.addNote("code", 1, 1) // Line 1 = index 0

      store.startSelection(4, false)
      store.updateComment("Comment 2")
      store.addNote("code", 5, 5) // Line 5 = index 4

      expect(store.linesWithNotes.has(0)).toBe(true)
      expect(store.linesWithNotes.has(4)).toBe(true)
      expect(store.linesWithNotes.size).toBe(2)
    })
  })

  describe("removeNote", () => {
    it("removes note by id", () => {
      store.startSelection(0, false)
      store.updateComment("Comment 1")
      store.addNote("code1", 1, 1)

      store.startSelection(5, false)
      store.updateComment("Comment 2")
      store.addNote("code2", 6, 6)

      const noteId = store.notes[0].id
      store.removeNote(noteId)

      expect(store.notes).toHaveLength(1)
      expect(store.notes[0].comment).toBe("Comment 2")
    })

    it("does nothing if note id not found", () => {
      store.startSelection(0, false)
      store.updateComment("Comment")
      store.addNote("code", 1, 1)

      store.removeNote("nonexistent-id")

      expect(store.notes).toHaveLength(1)
    })
  })

  describe("discardPending", () => {
    it("clears pending and showDiscardDialog", () => {
      store.startSelection(0, false)
      store.updateComment("Some text")
      store.showDiscardDialog = true

      store.discardPending()

      expect(store.pending).toBeNull()
      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("requestDiscard", () => {
    it("returns false and discards when no unsaved comment", () => {
      store.startSelection(0, false)

      const result = store.requestDiscard()

      expect(result).toBe(false)
      expect(store.pending).toBeNull()
    })

    it("returns true and shows dialog when has unsaved comment", () => {
      store.startSelection(0, false)
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

  describe("reset", () => {
    it("clears all state", () => {
      store.startSelection(0, false)
      store.updateComment("Comment")
      store.addNote("code", 1, 1)
      store.startSelection(5, false)
      store.showDiscardDialog = true

      store.reset()

      expect(store.pending).toBeNull()
      expect(store.notes).toEqual([])
      expect(store.showDiscardDialog).toBe(false)
    })
  })

  describe("formatReviewMessage", () => {
    const planContent = `# Plan
Line 2
Line 3
Line 4
Line 5
Line 6`

    it("returns empty string when no notes", () => {
      expect(store.formatReviewMessage(planContent)).toBe("")
    })

    it("formats a single note on one line", () => {
      store.startSelection(1, false)
      store.updateComment("This line needs work")
      store.addNote("Line 2", 2, 2)

      const message = store.formatReviewMessage(planContent)

      expect(message).toContain("User review comments on the proposed plan:")
      expect(message).toContain("## Line 2")
      expect(message).toContain("> Line 2")
      expect(message).toContain("This line needs work")
      expect(message).toContain("Please revise the plan based on the feedback above.")
    })

    it("formats a single note spanning multiple lines", () => {
      store.startSelection(1, false)
      store.extendSelection(3)
      store.updateComment("These lines need work")
      store.addNote("Line 2\nLine 3\nLine 4", 2, 4)

      const message = store.formatReviewMessage(planContent)

      expect(message).toContain("## Lines 2-4")
      expect(message).toContain("> Line 2")
      expect(message).toContain("> Line 3")
      expect(message).toContain("> Line 4")
    })

    it("formats multiple notes sorted by line number", () => {
      // Add note on lines 4-5 first
      store.startSelection(3, false)
      store.extendSelection(4)
      store.updateComment("Second section issue")
      store.addNote("Line 4\nLine 5", 4, 5)

      // Add note on line 2 second
      store.startSelection(1, false)
      store.updateComment("First section issue")
      store.addNote("Line 2", 2, 2)

      const message = store.formatReviewMessage(planContent)

      // Line 2 should come before Lines 4-5
      const line2Index = message.indexOf("## Line 2")
      const lines45Index = message.indexOf("## Lines 4-5")
      expect(line2Index).toBeLessThan(lines45Index)
    })

    it("includes separator and closing instruction", () => {
      store.startSelection(0, false)
      store.updateComment("Comment")
      store.addNote("# Plan", 1, 1)

      const message = store.formatReviewMessage(planContent)

      expect(message).toContain("---")
      expect(message).toContain("Please revise the plan based on the feedback above.")
    })
  })

  describe("createPlanReviewStore factory", () => {
    it("creates a new PlanReviewStore instance", () => {
      const store = createPlanReviewStore()

      expect(store).toBeInstanceOf(PlanReviewStore)
      expect(store.notes).toEqual([])
      expect(store.pending).toBeNull()
    })
  })

  describe("viewMode", () => {
    it("defaults to markdown", () => {
      expect(store.viewMode).toBe("markdown")
    })

    it("can be set to code", () => {
      store.setViewMode("code")
      expect(store.viewMode).toBe("code")
    })

    it("can be set back to markdown", () => {
      store.setViewMode("code")
      store.setViewMode("markdown")
      expect(store.viewMode).toBe("markdown")
    })

    it("is reset to markdown on reset()", () => {
      store.setViewMode("code")
      store.reset()
      expect(store.viewMode).toBe("markdown")
    })
  })

  describe("switchToCodeAtLine", () => {
    it("switches to code view and highlights line without opening editor", () => {
      store.switchToCodeAtLine(5)

      expect(store.viewMode).toBe("code")
      expect(store.highlightedLine).toBe(5)
      // Should NOT create a pending note (editor should not open)
      expect(store.pending).toBeNull()
    })

    it("highlights line 0 when called with 0", () => {
      store.switchToCodeAtLine(0)

      expect(store.viewMode).toBe("code")
      expect(store.highlightedLine).toBe(0)
    })
  })

  describe("highlightedLine", () => {
    it("defaults to null", () => {
      expect(store.highlightedLine).toBeNull()
    })

    it("is cleared when startSelection is called", () => {
      store.switchToCodeAtLine(5)
      expect(store.highlightedLine).toBe(5)

      store.startSelection(3, false)
      expect(store.highlightedLine).toBeNull()
    })

    it("is cleared on reset()", () => {
      store.switchToCodeAtLine(5)
      store.reset()
      expect(store.highlightedLine).toBeNull()
    })
  })
})
