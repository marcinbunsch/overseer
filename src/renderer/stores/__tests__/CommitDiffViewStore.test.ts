import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommitDiffViewStore, createCommitDiffViewStore } from "../CommitDiffViewStore"
import type { Commit, ChangedFile } from "../../types"

// Mock the git service
vi.mock("../../services/git", () => ({
  gitService: {
    listCommitFiles: vi.fn(),
    getCommitDiff: vi.fn(),
  },
}))

import { gitService } from "../../services/git"

describe("CommitDiffViewStore", () => {
  const mockCommit: Commit = { shortId: "abc1234", message: "Test commit" }
  const workspacePath = "/test/workspace"
  let store: CommitDiffViewStore

  beforeEach(() => {
    vi.clearAllMocks()
    store = new CommitDiffViewStore(workspacePath, mockCommit)
  })

  describe("initial state", () => {
    it("should start with loading status", () => {
      expect(store.status).toBe("loading")
    })

    it("should start with empty diff", () => {
      expect(store.diff).toBe("")
    })

    it("should start with filesLoading true", () => {
      expect(store.filesLoading).toBe(true)
    })

    it("should start with empty files array", () => {
      expect(store.files).toEqual([])
    })

    it("should have placeholder selectedFile", () => {
      expect(store.selectedFile.path).toBe("")
      expect(store.selectedFile.status).toBe("M")
    })

    it("should have no error", () => {
      expect(store.errorMessage).toBeNull()
      expect(store.filesError).toBeNull()
    })
  })

  describe("loadFiles", () => {
    it("should load files from git service", async () => {
      const mockFiles: ChangedFile[] = [
        { status: "M", path: "src/file1.ts" },
        { status: "A", path: "src/file2.ts" },
      ]
      vi.mocked(gitService.listCommitFiles).mockResolvedValue(mockFiles)
      vi.mocked(gitService.getCommitDiff).mockResolvedValue("diff content")

      await store.loadFiles()

      expect(gitService.listCommitFiles).toHaveBeenCalledWith(workspacePath, "abc1234")
      expect(store.files).toEqual(mockFiles)
      expect(store.filesLoading).toBe(false)
      expect(store.filesError).toBeNull()
    })

    it("should auto-select first file after loading", async () => {
      const mockFiles: ChangedFile[] = [
        { status: "M", path: "src/first.ts" },
        { status: "A", path: "src/second.ts" },
      ]
      vi.mocked(gitService.listCommitFiles).mockResolvedValue(mockFiles)
      vi.mocked(gitService.getCommitDiff).mockResolvedValue("diff content")

      await store.loadFiles()

      expect(store.selectedFile).toEqual(mockFiles[0])
      expect(gitService.getCommitDiff).toHaveBeenCalledWith(
        workspacePath,
        "abc1234",
        "src/first.ts",
        "M"
      )
    })

    it("should not auto-select if no files", async () => {
      vi.mocked(gitService.listCommitFiles).mockResolvedValue([])

      await store.loadFiles()

      expect(store.files).toEqual([])
      expect(store.selectedFile.path).toBe("")
      expect(gitService.getCommitDiff).not.toHaveBeenCalled()
    })

    it("should handle errors", async () => {
      vi.mocked(gitService.listCommitFiles).mockRejectedValue(new Error("Failed to list files"))

      await store.loadFiles()

      expect(store.filesError).toBe("Failed to list files")
      expect(store.filesLoading).toBe(false)
      expect(store.files).toEqual([])
    })

    it("should set filesLoading during fetch", async () => {
      let resolvePromise: (value: ChangedFile[]) => void
      const pendingPromise = new Promise<ChangedFile[]>((resolve) => {
        resolvePromise = resolve
      })
      vi.mocked(gitService.listCommitFiles).mockReturnValue(pendingPromise)

      const loadPromise = store.loadFiles()
      expect(store.filesLoading).toBe(true)

      resolvePromise!([])
      await loadPromise
      expect(store.filesLoading).toBe(false)
    })
  })

  describe("fetchDiff", () => {
    const testFile: ChangedFile = { status: "M", path: "src/test.ts" }

    it("should fetch diff from git service", async () => {
      const mockDiff = "diff --git a/src/test.ts b/src/test.ts\n..."
      vi.mocked(gitService.getCommitDiff).mockResolvedValue(mockDiff)

      await store.fetchDiff(testFile)

      expect(gitService.getCommitDiff).toHaveBeenCalledWith(
        workspacePath,
        "abc1234",
        "src/test.ts",
        "M"
      )
      expect(store.diff).toBe(mockDiff)
      expect(store.status).toBe("done")
      expect(store.errorMessage).toBeNull()
    })

    it("should cache diffs", async () => {
      const mockDiff = "cached diff content"
      vi.mocked(gitService.getCommitDiff).mockResolvedValue(mockDiff)

      // First fetch
      await store.fetchDiff(testFile)
      expect(gitService.getCommitDiff).toHaveBeenCalledTimes(1)

      // Second fetch - should use cache
      await store.fetchDiff(testFile)
      expect(gitService.getCommitDiff).toHaveBeenCalledTimes(1) // Still 1
      expect(store.diff).toBe(mockDiff)
      expect(store.status).toBe("done")
    })

    it("should use different cache keys for different files", async () => {
      const file1: ChangedFile = { status: "M", path: "file1.ts" }
      const file2: ChangedFile = { status: "A", path: "file2.ts" }

      vi.mocked(gitService.getCommitDiff)
        .mockResolvedValueOnce("diff1")
        .mockResolvedValueOnce("diff2")

      await store.fetchDiff(file1)
      expect(store.diff).toBe("diff1")

      await store.fetchDiff(file2)
      expect(store.diff).toBe("diff2")

      expect(gitService.getCommitDiff).toHaveBeenCalledTimes(2)
    })

    it("should handle errors", async () => {
      vi.mocked(gitService.getCommitDiff).mockRejectedValue(new Error("Diff failed"))

      await store.fetchDiff(testFile)

      expect(store.status).toBe("error")
      expect(store.errorMessage).toBe("Diff failed")
    })

    it("should set loading during fetch", async () => {
      let resolvePromise: (value: string) => void
      const pendingPromise = new Promise<string>((resolve) => {
        resolvePromise = resolve
      })
      vi.mocked(gitService.getCommitDiff).mockReturnValue(pendingPromise)

      const fetchPromise = store.fetchDiff(testFile)
      expect(store.status).toBe("loading")

      resolvePromise!("diff")
      await fetchPromise
      expect(store.status).toBe("done")
    })
  })

  describe("selectFile", () => {
    it("should update selectedFile and fetch diff", async () => {
      const newFile: ChangedFile = { status: "A", path: "new/file.ts" }
      vi.mocked(gitService.getCommitDiff).mockResolvedValue("new diff")

      store.selectFile(newFile)

      expect(store.selectedFile).toEqual(newFile)
      // fetchDiff is called but async, wait for it
      await vi.waitFor(() => {
        expect(gitService.getCommitDiff).toHaveBeenCalled()
      })
    })
  })

  describe("reset", () => {
    it("should reset all state", async () => {
      // Set up some state
      const mockFiles: ChangedFile[] = [{ status: "M", path: "src/file.ts" }]
      vi.mocked(gitService.listCommitFiles).mockResolvedValue(mockFiles)
      vi.mocked(gitService.getCommitDiff).mockResolvedValue("diff content")

      await store.loadFiles()

      // Verify state is set
      expect(store.files.length).toBe(1)
      expect(store.diff).toBe("diff content")
      expect(store.status).toBe("done")

      // Reset
      store.reset()

      // Verify reset
      expect(store.status).toBe("loading")
      expect(store.diff).toBe("")
      expect(store.errorMessage).toBeNull()
      expect(store.files).toEqual([])
      expect(store.filesLoading).toBe(true)
      expect(store.filesError).toBeNull()
    })

    it("should clear the cache", async () => {
      const testFile: ChangedFile = { status: "M", path: "test.ts" }
      vi.mocked(gitService.getCommitDiff).mockResolvedValue("diff")

      // Fetch to populate cache
      await store.fetchDiff(testFile)
      expect(gitService.getCommitDiff).toHaveBeenCalledTimes(1)

      // Reset clears cache
      store.reset()

      // Fetch again - should call service again since cache is cleared
      await store.fetchDiff(testFile)
      expect(gitService.getCommitDiff).toHaveBeenCalledTimes(2)
    })
  })

  describe("fileName computed", () => {
    it("should return the file name from path", () => {
      store.selectFile({ status: "M", path: "src/components/Button.tsx" })
      expect(store.fileName).toBe("Button.tsx")
    })

    it("should handle paths without directories", () => {
      store.selectFile({ status: "M", path: "README.md" })
      expect(store.fileName).toBe("README.md")
    })

    it("should handle empty path", () => {
      // Default state has empty path
      expect(store.fileName).toBe("")
    })
  })

  describe("createCommitDiffViewStore factory", () => {
    it("should create a new store instance", () => {
      const commit: Commit = { shortId: "def5678", message: "Another commit" }
      const newStore = createCommitDiffViewStore("/another/path", commit)

      expect(newStore).toBeInstanceOf(CommitDiffViewStore)
      expect(newStore).not.toBe(store)
    })
  })
})
