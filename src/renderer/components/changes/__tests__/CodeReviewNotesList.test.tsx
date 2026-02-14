/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CodeReviewNotesList } from "../CodeReviewNotesList"
import type { DiffNote } from "../../../stores/DiffNotesStore"

describe("CodeReviewNotesList", () => {
  const mockOnRemoveNote = vi.fn()
  const mockOnNoteClick = vi.fn()

  const mockNotes: DiffNote[] = [
    {
      id: "note-1",
      filePath: "src/components/Button.tsx",
      startLine: 5,
      endLine: 5,
      lineContent: "+const x = 1",
      comment: "Why is this hardcoded?",
      createdAt: 1000,
    },
    {
      id: "note-2",
      filePath: "src/utils/helpers.ts",
      startLine: 10,
      endLine: 15,
      lineContent: "+function foo() {\n+  return bar\n+}",
      comment: "This needs better error handling",
      createdAt: 2000,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("empty state", () => {
    it("shows empty state message when no notes", () => {
      render(<CodeReviewNotesList notes={[]} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("No comments yet")).toBeInTheDocument()
    })

    it("shows instruction text", () => {
      render(<CodeReviewNotesList notes={[]} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Select lines in the diff to add comments")).toBeInTheDocument()
    })
  })

  describe("note display", () => {
    it("renders note cards for each note", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      const noteCards = screen.getAllByTestId("review-note")
      expect(noteCards).toHaveLength(2)
    })

    it("shows filename from filePath", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Button.tsx")).toBeInTheDocument()
      expect(screen.getByText("helpers.ts")).toBeInTheDocument()
    })

    it("shows line reference for single line", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Line 5")).toBeInTheDocument()
    })

    it("shows line range for multi-line", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Lines 10-15")).toBeInTheDocument()
    })

    it("shows comment text", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      expect(screen.getByText("Why is this hardcoded?")).toBeInTheDocument()
      expect(screen.getByText("This needs better error handling")).toBeInTheDocument()
    })

    it("shows delete button with opacity-0 by default (hidden until hover)", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      const removeButtons = screen.getAllByTestId("remove-note-button")
      expect(removeButtons[0]).toHaveClass("opacity-0")
    })
  })

  describe("interactions", () => {
    it("calls onNoteClick when note is clicked", () => {
      render(
        <CodeReviewNotesList
          notes={mockNotes}
          onRemoveNote={mockOnRemoveNote}
          onNoteClick={mockOnNoteClick}
        />
      )

      const noteCards = screen.getAllByTestId("review-note")
      fireEvent.click(noteCards[0])

      expect(mockOnNoteClick).toHaveBeenCalledWith(mockNotes[0])
    })

    it("calls onRemoveNote when delete button clicked", () => {
      render(<CodeReviewNotesList notes={mockNotes} onRemoveNote={mockOnRemoveNote} />)

      const removeButtons = screen.getAllByTestId("remove-note-button")
      fireEvent.click(removeButtons[0])

      expect(mockOnRemoveNote).toHaveBeenCalledWith("note-1")
    })

    it("does not propagate click to onNoteClick when delete button clicked (stopPropagation)", () => {
      render(
        <CodeReviewNotesList
          notes={mockNotes}
          onRemoveNote={mockOnRemoveNote}
          onNoteClick={mockOnNoteClick}
        />
      )

      const removeButtons = screen.getAllByTestId("remove-note-button")
      fireEvent.click(removeButtons[0])

      expect(mockOnRemoveNote).toHaveBeenCalled()
      expect(mockOnNoteClick).not.toHaveBeenCalled()
    })
  })

  describe("current file highlighting", () => {
    it("highlights note from current file with left border", () => {
      render(
        <CodeReviewNotesList
          notes={mockNotes}
          currentFilePath="src/components/Button.tsx"
          onRemoveNote={mockOnRemoveNote}
        />
      )

      const noteCards = screen.getAllByTestId("review-note")
      expect(noteCards[0]).toHaveClass("border-l-ovr-azure-500")
      expect(noteCards[1]).not.toHaveClass("border-l-ovr-azure-500")
    })
  })
})
