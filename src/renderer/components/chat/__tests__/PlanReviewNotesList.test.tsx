/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanReviewNotesList } from "../PlanReviewNotesList"
import type { PlanReviewNote } from "../../../stores/PlanReviewStore"

describe("PlanReviewNotesList", () => {
  const mockOnRemoveNote = vi.fn()
  const mockOnNoteClick = vi.fn()

  const mockNotes: PlanReviewNote[] = [
    {
      id: "note-1",
      startLine: 5,
      endLine: 5,
      lineContent: "const x = 1",
      comment: "Why is this hardcoded?",
      createdAt: 1000,
    },
    {
      id: "note-2",
      startLine: 10,
      endLine: 15,
      lineContent: "function foo() {\n  return bar\n}",
      comment: "This needs better error handling",
      createdAt: 2000,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("empty state", () => {
    it("shows empty state message when no notes", () => {
      render(<PlanReviewNotesList notes={[]} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("No comments yet")).toBeInTheDocument()
      expect(screen.getByText("Select lines in the plan to add comments")).toBeInTheDocument()
    })
  })

  describe("with notes", () => {
    it("renders all notes", () => {
      render(<PlanReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Why is this hardcoded?")).toBeInTheDocument()
      expect(screen.getByText("This needs better error handling")).toBeInTheDocument()
    })

    it("displays single line reference correctly", () => {
      render(<PlanReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Line 5")).toBeInTheDocument()
    })

    it("displays multi-line range reference correctly", () => {
      render(<PlanReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Lines 10-15")).toBeInTheDocument()
    })

    it("calls onRemoveNote when delete button clicked", () => {
      render(<PlanReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      const removeButtons = screen.getAllByTitle("Remove comment")
      fireEvent.click(removeButtons[0])

      expect(mockOnRemoveNote).toHaveBeenCalledWith("note-1")
    })

    it("calls onNoteClick when note is clicked", () => {
      render(
        <PlanReviewNotesList
          notes={mockNotes}
          onRemoveNote={mockOnRemoveNote}
          onNoteClick={mockOnNoteClick}
        />
      )

      const noteElements = screen.getAllByRole("button")
      fireEvent.click(noteElements[0])

      expect(mockOnNoteClick).toHaveBeenCalledWith(mockNotes[0])
    })

    it("does not propagate click to onNoteClick when remove button clicked", () => {
      render(
        <PlanReviewNotesList
          notes={mockNotes}
          onRemoveNote={mockOnRemoveNote}
          onNoteClick={mockOnNoteClick}
        />
      )

      const removeButtons = screen.getAllByTitle("Remove comment")
      fireEvent.click(removeButtons[0])

      expect(mockOnRemoveNote).toHaveBeenCalled()
      expect(mockOnNoteClick).not.toHaveBeenCalled()
    })
  })
})
