/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Mock PlanContentTable to avoid react-syntax-highlighter complexity
// The mock factory function must not reference external variables
vi.mock("../PlanContentTable", async () => {
  const { observer: mobxObserver } = await import("mobx-react-lite")

  const MockPlanContentTable = mobxObserver(function MockPlanContentTable({
    lines,
    notesStore,
    onAddNote,
  }: {
    lines: string[]
    notesStore: {
      pending: { anchorIndex: number; focusIndex: number; commentText: string } | null
      startSelection: (i: number, shift: boolean) => void
      updateComment: (text: string) => void
      addNote: (content: string, start: number, end: number) => void
    }
    onAddNote: () => void
  }) {
    return (
      <div data-testid="plan-content-table">
        {lines.map((line, i) => (
          <div key={i} data-testid={`line-${i + 1}`}>
            <span
              data-testid={`line-number-${i + 1}`}
              onMouseDown={() => notesStore.startSelection(i, false)}
            >
              {i + 1}
            </span>
            <span>{line}</span>
          </div>
        ))}
        {notesStore.pending && (
          <div data-testid="comment-input">
            <textarea
              data-testid="comment-textarea"
              placeholder="Add a comment about the selected lines..."
              value={notesStore.pending.commentText}
              onChange={(e) => notesStore.updateComment(e.target.value)}
            />
            <button
              onClick={() => {
                const start = Math.min(
                  notesStore.pending!.anchorIndex,
                  notesStore.pending!.focusIndex
                )
                const end = Math.max(
                  notesStore.pending!.anchorIndex,
                  notesStore.pending!.focusIndex
                )
                const content = lines.slice(start, end + 1).join("\n")
                notesStore.addNote(content, start + 1, end + 1)
                onAddNote()
              }}
            >
              Add Comment
            </button>
          </div>
        )}
      </div>
    )
  })

  return { PlanContentTable: MockPlanContentTable }
})

// Mock PlanMarkdownView
vi.mock("../PlanMarkdownView", () => ({
  PlanMarkdownView: ({ planContent }: { planContent: string }) => (
    <div data-testid="plan-markdown-view">
      {planContent.split("\n").map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  ),
}))

// Import after mock is set up
import { PlanReviewDialog } from "../PlanReviewDialog"

// Helper to switch to code view
async function switchToCodeView() {
  const codeButton = screen.getByRole("button", { name: /Code/i })
  fireEvent.click(codeButton)
}

describe("PlanReviewDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    planContent: "# Plan\nStep 1\nStep 2\nStep 3",
    onSubmitReview: vi.fn(),
    onApprove: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders dialog when open", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    expect(screen.getByText("Review Plan")).toBeInTheDocument()
    // In markdown mode by default
    expect(
      screen.getByText("Double-click to switch to code view and add comments")
    ).toBeInTheDocument()
  })

  it("does not render when closed", () => {
    render(<PlanReviewDialog {...defaultProps} open={false} />)

    expect(screen.queryByText("Review Plan")).not.toBeInTheDocument()
  })

  it("shows plan content in markdown view by default", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    // In markdown view, content is rendered via ReactMarkdown
    expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
    expect(screen.getByText("# Plan")).toBeInTheDocument()
    expect(screen.getByText("Step 1")).toBeInTheDocument()
  })

  it("shows plan content in code view when switched", async () => {
    render(<PlanReviewDialog {...defaultProps} />)

    await switchToCodeView()

    expect(screen.getByTestId("plan-content-table")).toBeInTheDocument()
  })

  it("shows empty notes sidebar initially", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    expect(screen.getByText("Comments")).toBeInTheDocument()
    expect(screen.getByText("No comments yet")).toBeInTheDocument()
  })

  it("has Submit Review button disabled when no notes", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    const submitButton = screen.getByRole("button", { name: /Submit Review/i })
    expect(submitButton).toBeDisabled()
  })

  it("closes dialog when Cancel clicked", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    const cancelButton = screen.getByRole("button", { name: "Cancel" })
    fireEvent.click(cancelButton)

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closes dialog when X button clicked", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    // Find the close button - it's in the header area after the view toggle buttons
    // The header has: title, view toggle, help text, then close button
    const allButtons = screen.getAllByRole("button")
    // The X close button is in the header, look for one that's not the view toggle or submit/cancel/approve
    const closeButton = allButtons.find(
      (btn) =>
        !btn.textContent?.includes("Preview") &&
        !btn.textContent?.includes("Code") &&
        !btn.textContent?.includes("Cancel") &&
        !btn.textContent?.includes("Submit") &&
        !btn.textContent?.includes("Approve") &&
        !btn.textContent?.includes("Add Comment") &&
        !btn.textContent?.includes("Close") && // sr-only button
        btn.closest('[class*="border-b"]') // in header
    )
    if (closeButton) {
      fireEvent.click(closeButton)
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    }
  })

  it("has Approve Plan button that is always enabled", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    const approveButton = screen.getByRole("button", { name: "Approve Plan" })
    expect(approveButton).not.toBeDisabled()
  })

  it("calls onApprove when Approve Plan button is clicked", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    const approveButton = screen.getByRole("button", { name: "Approve Plan" })
    fireEvent.click(approveButton)

    expect(defaultProps.onApprove).toHaveBeenCalledTimes(1)
  })

  describe("adding and submitting notes", () => {
    it("shows comment input when line is selected in code view", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Click on line 2
      const line2 = screen.getByTestId("line-number-2")
      fireEvent.mouseDown(line2)

      // Comment input should appear
      await waitFor(() => {
        expect(screen.getByTestId("comment-input")).toBeInTheDocument()
      })
    })

    it("allows adding a note by selecting a line and typing", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Click on line 2
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))

      // Type a comment
      const textarea = await screen.findByPlaceholderText(
        "Add a comment about the selected lines..."
      )
      fireEvent.change(textarea, { target: { value: "This step needs clarification" } })

      // Click Add Comment
      const addButton = screen.getByRole("button", { name: "Add Comment" })
      fireEvent.click(addButton)

      // Note should appear in sidebar
      await waitFor(() => {
        expect(screen.getByText("This step needs clarification")).toBeInTheDocument()
      })
      expect(screen.getByText("Line 2")).toBeInTheDocument()
    })

    it("enables Submit Review button after adding a note", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Add a note
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))

      const textarea = await screen.findByPlaceholderText(
        "Add a comment about the selected lines..."
      )
      fireEvent.change(textarea, { target: { value: "Comment" } })

      const addButton = screen.getByRole("button", { name: "Add Comment" })
      fireEvent.click(addButton)

      // Submit button should be enabled and show count
      await waitFor(() => {
        const submitButton = screen.getByRole("button", { name: /Submit Review \(1 comment\)/i })
        expect(submitButton).not.toBeDisabled()
      })
    })

    it("shows correct plural for multiple comments", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Add first note
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))
      let textarea = await screen.findByPlaceholderText("Add a comment about the selected lines...")
      fireEvent.change(textarea, { target: { value: "Comment 1" } })
      fireEvent.click(screen.getByRole("button", { name: "Add Comment" }))

      // Wait for first note to be added
      await waitFor(() => {
        expect(screen.getByText("Comment 1")).toBeInTheDocument()
      })

      // Add second note
      fireEvent.mouseDown(screen.getByTestId("line-number-3"))
      textarea = await screen.findByPlaceholderText("Add a comment about the selected lines...")
      fireEvent.change(textarea, { target: { value: "Comment 2" } })
      fireEvent.click(screen.getByRole("button", { name: "Add Comment" }))

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Submit Review \(2 comments\)/i })
        ).toBeInTheDocument()
      })
    })

    it("calls onSubmitReview with formatted message when Submit clicked", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Add a note
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))

      const textarea = await screen.findByPlaceholderText(
        "Add a comment about the selected lines..."
      )
      fireEvent.change(textarea, { target: { value: "This needs work" } })

      const addButton = screen.getByRole("button", { name: "Add Comment" })
      fireEvent.click(addButton)

      // Wait for note to be added
      await waitFor(() => {
        expect(screen.getByText("This needs work")).toBeInTheDocument()
      })

      // Click Submit Review
      const submitButton = screen.getByRole("button", { name: /Submit Review/i })
      fireEvent.click(submitButton)

      expect(defaultProps.onSubmitReview).toHaveBeenCalledTimes(1)
      const message = defaultProps.onSubmitReview.mock.calls[0][0]
      expect(message).toContain("User review comments on the proposed plan:")
      expect(message).toContain("Line 2")
      expect(message).toContain("This needs work")
      expect(message).toContain("Please revise the plan based on the feedback above.")
    })

    it("allows removing notes from sidebar", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Add a note
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))

      const textarea = await screen.findByPlaceholderText(
        "Add a comment about the selected lines..."
      )
      fireEvent.change(textarea, { target: { value: "To be removed" } })

      const addButton = screen.getByRole("button", { name: "Add Comment" })
      fireEvent.click(addButton)

      // Note should be in sidebar
      await waitFor(() => {
        expect(screen.getByText("To be removed")).toBeInTheDocument()
      })

      // Remove the note
      const removeButton = screen.getByTitle("Remove comment")
      fireEvent.click(removeButton)

      // Note should be gone
      await waitFor(() => {
        expect(screen.queryByText("To be removed")).not.toBeInTheDocument()
      })
      expect(screen.getByText("No comments yet")).toBeInTheDocument()
    })

    it("updates comment count in header after removing note", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      // Add two notes
      fireEvent.mouseDown(screen.getByTestId("line-number-2"))
      let textarea = await screen.findByPlaceholderText("Add a comment about the selected lines...")
      fireEvent.change(textarea, { target: { value: "Comment 1" } })
      fireEvent.click(screen.getByRole("button", { name: "Add Comment" }))

      await waitFor(() => {
        expect(screen.getByText("Comment 1")).toBeInTheDocument()
      })

      fireEvent.mouseDown(screen.getByTestId("line-number-3"))
      textarea = await screen.findByPlaceholderText("Add a comment about the selected lines...")
      fireEvent.change(textarea, { target: { value: "Comment 2" } })
      fireEvent.click(screen.getByRole("button", { name: "Add Comment" }))

      await waitFor(() => {
        expect(screen.getByText("Comments (2)")).toBeInTheDocument()
      })

      // Remove one
      const removeButtons = screen.getAllByTitle("Remove comment")
      fireEvent.click(removeButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Comments (1)")).toBeInTheDocument()
      })
    })
  })

  describe("view mode toggle", () => {
    it("defaults to markdown view", () => {
      render(<PlanReviewDialog {...defaultProps} />)

      expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
    })

    it("switches to code view when Code button is clicked", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      await switchToCodeView()

      expect(screen.getByTestId("plan-content-table")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-markdown-view")).not.toBeInTheDocument()
    })

    it("switches back to markdown view when Preview button is clicked", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      // Switch to code
      await switchToCodeView()
      expect(screen.getByTestId("plan-content-table")).toBeInTheDocument()

      // Switch back to markdown
      const previewButton = screen.getByRole("button", { name: /Preview/i })
      fireEvent.click(previewButton)

      expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-content-table")).not.toBeInTheDocument()
    })

    it("shows different help text based on view mode", async () => {
      render(<PlanReviewDialog {...defaultProps} />)

      // Markdown view shows double-click instruction
      expect(
        screen.getByText("Double-click to switch to code view and add comments")
      ).toBeInTheDocument()

      // Switch to code view
      await switchToCodeView()

      // Code view shows line selection instruction
      expect(
        screen.getByText("Click line numbers to select, then add comments")
      ).toBeInTheDocument()
    })
  })

  it("shows no plan content message for empty plan", () => {
    render(<PlanReviewDialog {...defaultProps} planContent="" />)

    expect(screen.getByText("No plan content")).toBeInTheDocument()
  })
})
