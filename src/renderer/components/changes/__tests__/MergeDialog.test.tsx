/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MergeDialog } from "../MergeDialog"

describe("MergeDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onMerge: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with checkbox checked by default", () => {
    render(<MergeDialog {...defaultProps} />)

    const checkbox = screen.getByTestId("delete-branch-checkbox")
    expect(checkbox).toBeChecked()
  })

  it("calls onMerge with archiveAfter=false and deleteBranch=false when Just merge clicked", () => {
    render(<MergeDialog {...defaultProps} />)

    fireEvent.click(screen.getByTestId("just-merge-button"))
    // Just merge intentionally ignores the checkbox - it cannot delete the branch
    expect(defaultProps.onMerge).toHaveBeenCalledWith(false, false)
  })

  it("calls onMerge with archiveAfter=true and deleteBranch=true when Merge & archive clicked with default checkbox", () => {
    render(<MergeDialog {...defaultProps} />)

    fireEvent.click(screen.getByTestId("merge-archive-button"))
    expect(defaultProps.onMerge).toHaveBeenCalledWith(true, true)
  })

  it("calls onMerge with deleteBranch=false when checkbox is unchecked", () => {
    render(<MergeDialog {...defaultProps} />)

    const checkbox = screen.getByTestId("delete-branch-checkbox")
    fireEvent.click(checkbox) // uncheck it
    fireEvent.click(screen.getByTestId("merge-archive-button"))
    expect(defaultProps.onMerge).toHaveBeenCalledWith(true, false)
  })

  it("ignores deleteBranch checkbox for Just merge (always passes false)", () => {
    render(<MergeDialog {...defaultProps} />)

    // Checkbox is checked by default, but Just merge should ignore it
    fireEvent.click(screen.getByTestId("just-merge-button"))
    expect(defaultProps.onMerge).toHaveBeenCalledWith(false, false)
  })
})
