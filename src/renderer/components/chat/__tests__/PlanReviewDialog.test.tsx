/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Mock PlanDiffView to avoid @pierre/diffs complexity
vi.mock("../PlanDiffView", () => ({
  PlanDiffView: ({
    planContent,
    previousPlanContent,
  }: {
    planContent: string
    previousPlanContent: string | null
  }) => (
    <div data-testid="plan-diff-view">
      <div data-testid="diff-content">
        {previousPlanContent === null ? "Initial plan (all additions)" : "Plan diff"}
      </div>
      <div>{planContent}</div>
    </div>
  ),
}))

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

describe("PlanReviewDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    planContent: "# Plan\nStep 1\nStep 2\nStep 3",
    previousPlanContent: null as string | null,
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
      screen.getByText("Double-click to switch to diff view and add comments")
    ).toBeInTheDocument()
  })

  it("does not render when closed", () => {
    render(<PlanReviewDialog {...defaultProps} open={false} />)

    expect(screen.queryByText("Review Plan")).not.toBeInTheDocument()
  })

  it("shows markdown view by default", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
    expect(screen.queryByTestId("plan-diff-view")).not.toBeInTheDocument()
  })

  it("shows plan content in diff view when switched", () => {
    render(<PlanReviewDialog {...defaultProps} />)

    // Click Diff button
    const diffButton = screen.getByRole("button", { name: /Diff/i })
    fireEvent.click(diffButton)

    expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument()
    expect(screen.queryByTestId("plan-markdown-view")).not.toBeInTheDocument()
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

  describe("view mode toggle", () => {
    it("defaults to markdown view", () => {
      render(<PlanReviewDialog {...defaultProps} />)

      expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-diff-view")).not.toBeInTheDocument()
    })

    it("switches to diff view when Diff button is clicked", () => {
      render(<PlanReviewDialog {...defaultProps} />)

      const diffButton = screen.getByRole("button", { name: /Diff/i })
      fireEvent.click(diffButton)

      expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-markdown-view")).not.toBeInTheDocument()
    })

    it("switches back to markdown view when Preview button is clicked", () => {
      render(<PlanReviewDialog {...defaultProps} />)

      // Switch to diff
      const diffButton = screen.getByRole("button", { name: /Diff/i })
      fireEvent.click(diffButton)
      expect(screen.getByTestId("plan-diff-view")).toBeInTheDocument()

      // Switch back to markdown
      const previewButton = screen.getByRole("button", { name: /Preview/i })
      fireEvent.click(previewButton)

      expect(screen.getByTestId("plan-markdown-view")).toBeInTheDocument()
      expect(screen.queryByTestId("plan-diff-view")).not.toBeInTheDocument()
    })

    it("shows different help text based on view mode", () => {
      render(<PlanReviewDialog {...defaultProps} />)

      // Markdown view shows double-click instruction (default)
      expect(
        screen.getByText("Double-click to switch to diff view and add comments")
      ).toBeInTheDocument()

      // Switch to diff view
      const diffButton = screen.getByRole("button", { name: /Diff/i })
      fireEvent.click(diffButton)

      // Diff view shows line selection instruction
      expect(screen.getByText("Click lines to select, then add comments")).toBeInTheDocument()
    })
  })

  describe("previousPlanContent handling", () => {
    it("shows initial plan indicator when previousPlanContent is null", () => {
      render(<PlanReviewDialog {...defaultProps} previousPlanContent={null} />)

      // Switch to diff view to see the indicator
      const diffButton = screen.getByRole("button", { name: /Diff/i })
      fireEvent.click(diffButton)

      expect(screen.getByText("Initial plan (all additions)")).toBeInTheDocument()
    })

    it("shows diff indicator when previousPlanContent exists", () => {
      render(
        <PlanReviewDialog
          {...defaultProps}
          previousPlanContent="# Old Plan\nStep 1"
          planContent="# Plan\nStep 1\nStep 2"
        />
      )

      // Switch to diff view to see the indicator
      const diffButton = screen.getByRole("button", { name: /Diff/i })
      fireEvent.click(diffButton)

      expect(screen.getByText("Plan diff")).toBeInTheDocument()
    })
  })

  it("shows no plan content message for empty plan", () => {
    render(<PlanReviewDialog {...defaultProps} planContent="" />)

    expect(screen.getByText("No plan content")).toBeInTheDocument()
  })
})
