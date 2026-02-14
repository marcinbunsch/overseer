/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlanMarkdownView } from "../PlanMarkdownView"
import { PlanReviewStore, PLAN_FILE_PATH } from "../../../stores/PlanReviewStore"

// Mock react-markdown to simplify testing
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">
      {children.split("\n").map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  ),
}))

vi.mock("remark-gfm", () => ({
  default: () => {},
}))

vi.mock("react-syntax-highlighter", () => ({
  PrismAsyncLight: ({ children }: { children: string }) => <code>{children}</code>,
}))

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}))

describe("PlanMarkdownView", () => {
  let store: PlanReviewStore
  const planContent = "# Plan\nStep 1\nStep 2\nStep 3"

  beforeEach(() => {
    vi.clearAllMocks()
    store = new PlanReviewStore()
  })

  it("renders markdown content", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    expect(screen.getByTestId("markdown-content")).toBeInTheDocument()
    expect(screen.getByText("# Plan")).toBeInTheDocument()
  })

  it("shows instruction text for double-click", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    expect(
      screen.getByText("Double-click anywhere to switch to diff view and add comments")
    ).toBeInTheDocument()
  })

  it("switches to diff view on double-click", () => {
    store.setViewMode("markdown") // Start in markdown mode
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    const content = screen.getByText("Step 1")
    fireEvent.doubleClick(content)

    expect(store.viewMode).toBe("diff")
  })

  it("highlights the clicked line on double-click", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    const content = screen.getByText("Step 2")
    fireEvent.doubleClick(content)

    // Should find the line containing "Step 2" (line index 2)
    expect(store.highlightedLine).toBe(2)
  })

  it("does not show comment count badge when no notes", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    // Should not show the "X comment(s)" badge (but instruction text with "comments" is OK)
    expect(screen.queryByText(/^\d+ comments?$/)).not.toBeInTheDocument()
  })

  it("shows comment count badge when notes exist", () => {
    // Add a note
    store.startSelection(PLAN_FILE_PATH, 1, false)
    store.updateComment("Test comment")
    store.addNote("Step 1", 2, 2)

    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    expect(screen.getByText("1 comment")).toBeInTheDocument()
  })

  it("shows plural comment count for multiple notes", () => {
    // Add two notes
    store.startSelection(PLAN_FILE_PATH, 1, false)
    store.updateComment("Comment 1")
    store.addNote("Step 1", 2, 2)

    store.startSelection(PLAN_FILE_PATH, 2, false)
    store.updateComment("Comment 2")
    store.addNote("Step 2", 3, 3)

    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    expect(screen.getByText("2 comments")).toBeInTheDocument()
  })

  it("falls back to line 0 when clicked text not found", () => {
    store.setViewMode("markdown") // Start in markdown mode
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    // Double-click on something that won't match any line
    const container = screen.getByTestId("markdown-content")
    fireEvent.doubleClick(container)

    expect(store.viewMode).toBe("diff")
    expect(store.highlightedLine).toBe(0)
  })
})
