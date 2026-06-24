/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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

// Mock gitService
vi.mock("../../../services/git", () => ({
  gitService: {
    listRecentBranches: vi.fn(),
  },
}))

import { gitService } from "../../../services/git"

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

  it("shows spinner while loading recent branches", () => {
    vi.mocked(gitService.listRecentBranches).mockReturnValue(new Promise(() => {}))

    render(<NewWorkspaceDialog {...defaultProps} repoPath="/repo" />)

    expect(screen.getByTestId("recent-branches-loading")).toBeInTheDocument()
  })

  it("shows recent branches after loading", async () => {
    vi.mocked(gitService.listRecentBranches).mockResolvedValue([
      "feature-a",
      "feature-b",
      "feature-c",
    ])

    render(<NewWorkspaceDialog {...defaultProps} repoPath="/repo" />)

    await waitFor(() => {
      expect(screen.getByTestId("recent-branches-list")).toBeInTheDocument()
    })

    const items = screen.getAllByTestId("recent-branch-item")
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent("feature-a")
    expect(items[1]).toHaveTextContent("feature-b")
    expect(items[2]).toHaveTextContent("feature-c")
  })

  it("filters out existing branches and main branch", async () => {
    vi.mocked(gitService.listRecentBranches).mockResolvedValue([
      "main",
      "feature-a",
      "already-open",
      "feature-b",
    ])

    render(
      <NewWorkspaceDialog
        {...defaultProps}
        repoPath="/repo"
        existingBranches={["already-open"]}
        mainBranch="main"
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId("recent-branches-list")).toBeInTheDocument()
    })

    const items = screen.getAllByTestId("recent-branch-item")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("feature-a")
    expect(items[1]).toHaveTextContent("feature-b")
  })

  it("limits recent branches to 10", async () => {
    const branches = Array.from({ length: 15 }, (_, i) => `feature-${i}`)
    vi.mocked(gitService.listRecentBranches).mockResolvedValue(branches)

    render(<NewWorkspaceDialog {...defaultProps} repoPath="/repo" />)

    await waitFor(() => {
      expect(screen.getByTestId("recent-branches-list")).toBeInTheDocument()
    })

    expect(screen.getAllByTestId("recent-branch-item")).toHaveLength(10)
  })

  it("hides the recent branches section when list is empty after filtering", async () => {
    vi.mocked(gitService.listRecentBranches).mockResolvedValue(["main"])

    render(<NewWorkspaceDialog {...defaultProps} repoPath="/repo" mainBranch="main" />)

    await waitFor(() => {
      expect(screen.queryByTestId("recent-branches-loading")).not.toBeInTheDocument()
    })

    expect(screen.queryByTestId("recent-branches-list")).not.toBeInTheDocument()
  })

  it("clicking a recent branch calls onCreate and closes the dialog", async () => {
    vi.mocked(gitService.listRecentBranches).mockResolvedValue(["feature-x"])

    render(<NewWorkspaceDialog {...defaultProps} repoPath="/repo" />)

    await waitFor(() => {
      expect(screen.getByTestId("recent-branches-list")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("recent-branch-item"))

    expect(defaultProps.onCreate).toHaveBeenCalledWith("feature-x")
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not fetch branches when repoPath is not provided", () => {
    render(<NewWorkspaceDialog {...defaultProps} />)

    expect(gitService.listRecentBranches).not.toHaveBeenCalled()
    expect(screen.queryByTestId("recent-branches-loading")).not.toBeInTheDocument()
  })
})
