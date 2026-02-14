/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { EditDiffDialog } from "../EditDiffDialog"

// Mock @pierre/diffs/react
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: () => <div data-testid="pierre-diff">PatchDiff</div>,
  MultiFileDiff: ({
    oldFile,
    newFile,
  }: {
    oldFile: { contents: string }
    newFile: { contents: string }
  }) => (
    <div data-testid="pierre-multi-diff">
      <div>Old: {oldFile.contents}</div>
      <div>New: {newFile.contents}</div>
    </div>
  ),
}))

// Mock ProjectRegistry
vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspaceStore: {
      sendMessage: vi.fn(),
    },
  },
}))

// Mock external service
const mockOpenInEditor = vi.hoisted(() => vi.fn())
vi.mock("../../../services/external", () => ({
  externalService: {
    openInEditor: mockOpenInEditor,
  },
}))

describe("EditDiffDialog", () => {
  const mockOnOpenChange = vi.fn()

  const defaultProps = {
    open: true,
    onOpenChange: mockOnOpenChange,
    filePath: "/home/user/project/src/file.ts",
    oldString: "const a = 1\nconst b = 2",
    newString: "const a = 1\nconst b = 3",
    label: "Edit",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenInEditor.mockClear()
  })

  describe("rendering", () => {
    it("renders the dialog when open", () => {
      render(<EditDiffDialog {...defaultProps} />)

      expect(screen.getByText("file.ts")).toBeInTheDocument()
    })

    it("shows the file path in header", () => {
      render(<EditDiffDialog {...defaultProps} />)

      expect(screen.getByText("/home/user/project/src/file.ts")).toBeInTheDocument()
    })

    it("shows the label badge", () => {
      render(<EditDiffDialog {...defaultProps} />)

      expect(screen.getByText("Edit")).toBeInTheDocument()
    })

    it("renders diff content using MultiFileDiff", async () => {
      render(<EditDiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-multi-diff")).toBeInTheDocument()
      })
    })

    it("shows No changes when old and new are equal", () => {
      render(<EditDiffDialog {...defaultProps} oldString="same content" newString="same content" />)

      expect(screen.getByText("No changes")).toBeInTheDocument()
    })

    it("shows view mode toggle buttons", () => {
      render(<EditDiffDialog {...defaultProps} />)

      expect(screen.getByText("Unified")).toBeInTheDocument()
      expect(screen.getByText("Split")).toBeInTheDocument()
    })
  })

  describe("keyboard shortcuts", () => {
    it("Cmd+O opens file in editor", async () => {
      render(<EditDiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText("file.ts")).toBeInTheDocument()
      })

      fireEvent.keyDown(window, { key: "o", metaKey: true })

      expect(mockOpenInEditor).toHaveBeenCalledWith("/home/user/project/src/file.ts")
    })

    it("Cmd+O does not trigger when dialog is closed", async () => {
      render(<EditDiffDialog {...defaultProps} open={false} />)

      fireEvent.keyDown(window, { key: "o", metaKey: true })

      expect(mockOpenInEditor).not.toHaveBeenCalled()
    })
  })
})
