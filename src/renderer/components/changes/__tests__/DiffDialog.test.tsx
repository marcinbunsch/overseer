/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { DiffDialog } from "../DiffDialog"
import type { ChangedFile } from "../../../types"

// Mock @pierre/diffs/react
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => (
    <div data-testid="pierre-diff">
      {patch.split("\n").map((line, i) => (
        <div key={i}>
          {line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")
            ? line.slice(1)
            : line}
        </div>
      ))}
    </div>
  ),
  MultiFileDiff: () => <div data-testid="pierre-multi-diff">MultiFileDiff</div>,
}))

// Mock the session store
vi.mock("../../../stores/SessionStore", () => ({
  sessionStore: {
    sendMessage: vi.fn(),
  },
}))

// Mock the git service
vi.mock("../../../services/git", () => ({
  gitService: {
    getDiff: vi.fn().mockResolvedValue(`diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4`),
    getFileDiff: vi.fn().mockResolvedValue(`diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4`),
    getUncommittedDiff: vi.fn().mockResolvedValue(`diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
 const c = 4`),
  },
}))

// Mock external service
const mockOpenInEditor = vi.hoisted(() => vi.fn())
vi.mock("../../../services/external", () => ({
  externalService: {
    openInEditor: mockOpenInEditor,
  },
}))

describe("DiffDialog", () => {
  const mockOnOpenChange = vi.fn()
  const mockFile: ChangedFile = {
    path: "src/test.txt",
    status: "M",
    isUncommitted: false,
  }

  const defaultProps = {
    open: true,
    onOpenChange: mockOnOpenChange,
    workspacePath: "/test/repo",
    uncommittedFiles: [],
    branchFiles: [mockFile],
    initialFile: mockFile,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenInEditor.mockClear()
  })

  describe("initial state", () => {
    it("shows the diff when loaded", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-diff")).toBeInTheDocument()
      })
    })

    it("displays the file name in header", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        // Header contains filename as h2 title
        const titles = screen.getAllByText("test.txt")
        expect(titles.length).toBeGreaterThan(0)
      })
    })

    it("sidebar hidden when review mode off", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-diff")).toBeInTheDocument()
      })

      expect(screen.queryByTestId("review-notes-sidebar")).not.toBeInTheDocument()
    })

    it("footer hidden when review mode off", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-diff")).toBeInTheDocument()
      })

      expect(screen.queryByTestId("submit-review-button")).not.toBeInTheDocument()
      expect(screen.queryByTestId("cancel-review-button")).not.toBeInTheDocument()
    })
  })

  describe("file navigation", () => {
    it("displays file list in sidebar", async () => {
      const files: ChangedFile[] = [
        { path: "file1.ts", status: "M", isUncommitted: false },
        { path: "file2.ts", status: "A", isUncommitted: false },
      ]
      render(<DiffDialog {...defaultProps} branchFiles={files} initialFile={files[0]} />)

      await waitFor(() => {
        // Files appear in both sidebar list and potentially in header
        const file1Elements = screen.getAllByText("file1.ts")
        const file2Elements = screen.getAllByText("file2.ts")
        expect(file1Elements.length).toBeGreaterThan(0)
        expect(file2Elements.length).toBeGreaterThan(0)
      })
    })
  })

  describe("keyboard shortcuts", () => {
    it("Cmd+O opens current file in editor", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-diff")).toBeInTheDocument()
      })

      fireEvent.keyDown(window, { key: "o", metaKey: true })

      expect(mockOpenInEditor).toHaveBeenCalledWith("/test/repo/src/test.txt")
    })
  })

  describe("view mode toggle", () => {
    it("shows unified/split toggle buttons", async () => {
      render(<DiffDialog {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByTestId("pierre-diff")).toBeInTheDocument()
      })

      expect(screen.getByText("Unified")).toBeInTheDocument()
      expect(screen.getByText("Split")).toBeInTheDocument()
    })
  })
})
