/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanContentTable } from "../PlanContentTable"
import { PlanReviewStore } from "../../../stores/PlanReviewStore"

// Mock react-syntax-highlighter to avoid complexity in tests
vi.mock("react-syntax-highlighter", () => ({
  Prism: ({
    renderer,
  }: {
    children: string
    renderer: (props: { rows: never[]; stylesheet: Record<string, never> }) => React.ReactNode
  }) => {
    // Just render the content without syntax highlighting
    return renderer({ rows: [], stylesheet: {} })
  },
}))

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}))

describe("PlanContentTable", () => {
  let store: PlanReviewStore
  const mockOnAddNote = vi.fn()

  const lines = ["# Header", "Line 2", "Line 3", "Line 4", "Line 5"]

  beforeEach(() => {
    vi.clearAllMocks()
    store = new PlanReviewStore()
  })

  it("renders all lines with line numbers", () => {
    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    // Check line numbers are rendered (1-based)
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()

    // Check content is rendered
    expect(screen.getByText("# Header")).toBeInTheDocument()
    expect(screen.getByText("Line 2")).toBeInTheDocument()
  })

  it("starts selection when line number is clicked", () => {
    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const lineNumber = screen.getByText("3")
    fireEvent.mouseDown(lineNumber)

    expect(store.pending).not.toBeNull()
    expect(store.pending?.anchorIndex).toBe(2) // 0-based
    expect(store.pending?.focusIndex).toBe(2)
  })

  it("extends selection with shift+click", () => {
    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    // Start selection at line 2
    const line2 = screen.getByText("2")
    fireEvent.mouseDown(line2)

    // Shift+click line 4
    const line4 = screen.getByText("4")
    fireEvent.mouseDown(line4, { shiftKey: true })

    expect(store.selectionStart).toBe(1) // 0-based
    expect(store.selectionEnd).toBe(3)
  })

  it("shows comment input when lines are selected", () => {
    store.startSelection(1, false) // Select line 2 (0-based index 1)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    expect(
      screen.getByPlaceholderText("Add a comment about the selected lines...")
    ).toBeInTheDocument()
    expect(screen.getByText("line 2")).toBeInTheDocument() // Line reference
    expect(screen.getByRole("button", { name: "Add Comment" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })

  it("shows multi-line reference when multiple lines selected", () => {
    store.startSelection(1, false)
    store.extendSelection(3)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    expect(screen.getByText("lines 2-4")).toBeInTheDocument()
  })

  it("updates comment text in store when typing", () => {
    store.startSelection(0, false)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const textarea = screen.getByPlaceholderText("Add a comment about the selected lines...")
    fireEvent.change(textarea, { target: { value: "My comment" } })

    expect(store.pending?.commentText).toBe("My comment")
  })

  it("adds note and calls onAddNote when Add Comment clicked", () => {
    store.startSelection(1, false)
    store.updateComment("Test comment")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const addButton = screen.getByRole("button", { name: "Add Comment" })
    fireEvent.click(addButton)

    expect(store.notes).toHaveLength(1)
    expect(store.notes[0].comment).toBe("Test comment")
    expect(store.notes[0].startLine).toBe(2) // 1-based
    expect(store.notes[0].endLine).toBe(2)
    expect(mockOnAddNote).toHaveBeenCalled()
  })

  it("disables Add Comment button when comment is empty", () => {
    store.startSelection(0, false)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const addButton = screen.getByRole("button", { name: "Add Comment" })
    expect(addButton).toBeDisabled()
  })

  it("enables Add Comment button when comment has text", () => {
    store.startSelection(0, false)
    store.updateComment("Some text")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const addButton = screen.getByRole("button", { name: "Add Comment" })
    expect(addButton).not.toBeDisabled()
  })

  it("clears selection when Cancel clicked with empty comment", () => {
    store.startSelection(0, false)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const cancelButton = screen.getByRole("button", { name: "Cancel" })
    fireEvent.click(cancelButton)

    expect(store.pending).toBeNull()
  })

  it("shows discard dialog when Cancel clicked with non-empty comment", () => {
    store.startSelection(0, false)
    store.updateComment("Some text")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const cancelButton = screen.getByRole("button", { name: "Cancel" })
    fireEvent.click(cancelButton)

    expect(store.showDiscardDialog).toBe(true)
  })

  it("submits note on Ctrl+Enter", () => {
    store.startSelection(0, false)
    store.updateComment("Comment via keyboard")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const textarea = screen.getByPlaceholderText("Add a comment about the selected lines...")
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true })

    expect(store.notes).toHaveLength(1)
    expect(mockOnAddNote).toHaveBeenCalled()
  })

  it("submits note on Cmd+Enter", () => {
    store.startSelection(0, false)
    store.updateComment("Comment via keyboard")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const textarea = screen.getByPlaceholderText("Add a comment about the selected lines...")
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true })

    expect(store.notes).toHaveLength(1)
    expect(mockOnAddNote).toHaveBeenCalled()
  })

  it("clears selection on Escape with empty comment", () => {
    store.startSelection(0, false)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const textarea = screen.getByPlaceholderText("Add a comment about the selected lines...")
    fireEvent.keyDown(textarea, { key: "Escape" })

    expect(store.pending).toBeNull()
  })

  it("shows discard dialog on Escape with non-empty comment", () => {
    store.startSelection(0, false)
    store.updateComment("Some text")

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    const textarea = screen.getByPlaceholderText("Add a comment about the selected lines...")
    fireEvent.keyDown(textarea, { key: "Escape" })

    expect(store.showDiscardDialog).toBe(true)
  })

  it("shows Save button when editing an existing note", () => {
    // Add a note first
    store.startSelection(1, false)
    store.updateComment("Original comment")
    store.addNote("Line 2", 2, 2)

    // Edit the note
    store.editNote(store.notes[0])

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    // Should show "Save" instead of "Add Comment"
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add Comment" })).not.toBeInTheDocument()
  })

  it("clears highlight when starting a new selection", () => {
    // Set a highlight (simulating double-click from markdown view)
    store.switchToCodeAtLine(2)
    expect(store.highlightedLine).toBe(2)

    render(<PlanContentTable lines={lines} notesStore={store} onAddNote={mockOnAddNote} />)

    // Click to start selection
    const lineNumber = screen.getByText("4")
    fireEvent.mouseDown(lineNumber)

    // Highlight should be cleared
    expect(store.highlightedLine).toBeNull()
  })
})
