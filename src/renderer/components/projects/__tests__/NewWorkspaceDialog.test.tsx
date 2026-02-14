/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { NewWorkspaceDialog } from "../NewWorkspaceDialog"

// Mock faker to return predictable values
vi.mock("@faker-js/faker", () => ({
  faker: {
    animal: { type: () => "dog" },
    word: {
      adjective: () => "happy",
      noun: () => "cloud",
    },
  },
}))

describe("NewWorkspaceDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCreate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with a random branch name", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    const input = screen.getByPlaceholderText("feature/my-branch")
    expect(input).toBeInTheDocument()
    // Mocked faker produces "dog-happy-cloud"
    expect((input as HTMLInputElement).value).toBe("dog-happy-cloud")
  })

  it("calls onCreate with branch name when Create is clicked", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    const input = screen.getByPlaceholderText("feature/my-branch")
    fireEvent.change(input, { target: { value: "my-feature-branch" } })
    fireEvent.click(screen.getByText("Create"))

    expect(defaultProps.onCreate).toHaveBeenCalledWith("my-feature-branch")
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("creates workspace on Enter key press", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    const input = screen.getByPlaceholderText("feature/my-branch")
    fireEvent.change(input, { target: { value: "enter-branch" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(defaultProps.onCreate).toHaveBeenCalledWith("enter-branch")
  })

  it("does not call onCreate when branch name is empty", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    const input = screen.getByPlaceholderText("feature/my-branch")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.click(screen.getByText("Create"))

    expect(defaultProps.onCreate).not.toHaveBeenCalled()
  })

  it("does not render when open is false", () => {
    render(<NewWorkspaceDialog {...defaultProps} open={false} />)

    expect(screen.queryByText("New Workspace")).not.toBeInTheDocument()
  })

  it("trims whitespace from branch name", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    const input = screen.getByPlaceholderText("feature/my-branch")
    fireEvent.change(input, { target: { value: "  trimmed-branch  " } })
    fireEvent.click(screen.getByText("Create"))

    expect(defaultProps.onCreate).toHaveBeenCalledWith("trimmed-branch")
  })
})
