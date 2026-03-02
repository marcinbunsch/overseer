import { describe, it, expect, vi, beforeEach } from "vitest"
import { DiffViewStore, createDiffViewStore } from "../DiffViewStore"
import type { ChangedFile } from "../../types"

// Create a mock GitService instance
const mockGitService = {
  getFileDiff: vi.fn(),
  getUncommittedDiff: vi.fn(),
  getSubmoduleFileDiff: vi.fn(),
  getSubmoduleUncommittedDiff: vi.fn(),
}

describe("DiffViewStore", () => {
  const mockFile: ChangedFile = { path: "src/foo.ts", status: "M" }
  const mockFile2: ChangedFile = { path: "src/bar.ts", status: "A" }
  const mockUncommittedFile: ChangedFile = { path: "src/new.ts", status: "M", isUncommitted: true }
  const mockUntrackedFile: ChangedFile = {
    path: "src/untracked.ts",
    status: "?",
    isUncommitted: true,
  }
  const workspacePath = "/tmp/workspace"

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock git service
    mockGitService.getFileDiff = vi.fn()
    mockGitService.getUncommittedDiff = vi.fn()
    mockGitService.getSubmoduleFileDiff = vi.fn()
    mockGitService.getSubmoduleUncommittedDiff = vi.fn()
  })

  it("initializes with the given file and loading status", () => {
    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)

    expect(store.selectedFile).toEqual(mockFile)
    expect(store.status).toBe("loading")
    expect(store.diff).toBe("")
    expect(store.errorMessage).toBeNull()
  })

  it("fileName returns the file name from path", () => {
    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)

    expect(store.fileName).toBe("foo.ts")
  })

  it("fileName handles paths without slashes", () => {
    const store = new DiffViewStore(
      workspacePath,
      { path: "file.txt", status: "M" },
      mockGitService as never
    )

    expect(store.fileName).toBe("file.txt")
  })

  it("fetchDiff fetches and caches diff on success", async () => {
    vi.mocked(mockGitService.getFileDiff).mockResolvedValue("diff content here")

    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
    await store.fetchDiff(mockFile)

    expect(mockGitService.getFileDiff).toHaveBeenCalledWith(
      workspacePath,
      mockFile.path,
      mockFile.status
    )
    expect(store.status).toBe("done")
    expect(store.diff).toBe("diff content here")
    expect(store.errorMessage).toBeNull()
  })

  it("fetchDiff uses cache on second call", async () => {
    vi.mocked(mockGitService.getFileDiff).mockResolvedValue("cached diff")

    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
    await store.fetchDiff(mockFile)
    await store.fetchDiff(mockFile)

    expect(mockGitService.getFileDiff).toHaveBeenCalledTimes(1)
    expect(store.diff).toBe("cached diff")
  })

  it("fetchDiff sets error status on failure", async () => {
    vi.mocked(mockGitService.getFileDiff).mockRejectedValue(new Error("Failed to get diff"))

    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
    await store.fetchDiff(mockFile)

    expect(store.status).toBe("error")
    expect(store.errorMessage).toBe("Failed to get diff")
    expect(store.diff).toBe("")
  })

  it("selectFile updates selectedFile and fetches diff", async () => {
    vi.mocked(mockGitService.getFileDiff).mockResolvedValue("new diff")

    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
    store.selectFile(mockFile2)

    expect(store.selectedFile).toEqual(mockFile2)

    // Wait for the async fetchDiff to complete
    await vi.waitFor(() => {
      expect(store.status).toBe("done")
    })

    expect(mockGitService.getFileDiff).toHaveBeenCalledWith(
      workspacePath,
      mockFile2.path,
      mockFile2.status
    )
  })

  it("reset clears state and cache", async () => {
    vi.mocked(mockGitService.getFileDiff).mockResolvedValue("some diff")

    const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
    await store.fetchDiff(mockFile)

    expect(store.status).toBe("done")
    expect(store.diff).toBe("some diff")

    store.reset()

    expect(store.status).toBe("loading")
    expect(store.diff).toBe("")
    expect(store.errorMessage).toBeNull()

    // Cache should be cleared - next fetch should call the service again
    await store.fetchDiff(mockFile)
    expect(mockGitService.getFileDiff).toHaveBeenCalledTimes(2)
  })

  it("createDiffViewStore factory creates a store instance", () => {
    const store = createDiffViewStore(workspacePath, mockFile, mockGitService as never)

    expect(store).toBeInstanceOf(DiffViewStore)
    expect(store.selectedFile).toEqual(mockFile)
  })

  describe("uncommitted changes", () => {
    it("uses getUncommittedDiff for uncommitted files", async () => {
      vi.mocked(mockGitService.getUncommittedDiff).mockResolvedValue("uncommitted diff content")

      const store = new DiffViewStore(workspacePath, mockUncommittedFile, mockGitService as never)
      await store.fetchDiff(mockUncommittedFile)

      expect(mockGitService.getUncommittedDiff).toHaveBeenCalledWith(
        workspacePath,
        mockUncommittedFile.path,
        mockUncommittedFile.status
      )
      expect(mockGitService.getFileDiff).not.toHaveBeenCalled()
      expect(store.status).toBe("done")
      expect(store.diff).toBe("uncommitted diff content")
    })

    it("uses getFileDiff for branch files (not uncommitted)", async () => {
      vi.mocked(mockGitService.getFileDiff).mockResolvedValue("branch diff content")

      const store = new DiffViewStore(workspacePath, mockFile, mockGitService as never)
      await store.fetchDiff(mockFile)

      expect(mockGitService.getFileDiff).toHaveBeenCalledWith(
        workspacePath,
        mockFile.path,
        mockFile.status
      )
      expect(mockGitService.getUncommittedDiff).not.toHaveBeenCalled()
      expect(store.diff).toBe("branch diff content")
    })

    it("uses separate cache keys for uncommitted vs branch changes", async () => {
      vi.mocked(mockGitService.getFileDiff).mockResolvedValue("branch diff")
      vi.mocked(mockGitService.getUncommittedDiff).mockResolvedValue("uncommitted diff")

      // Create a file that exists in both uncommitted and branch (same path, different isUncommitted)
      const branchFile: ChangedFile = { path: "src/shared.ts", status: "M" }
      const uncommittedFile: ChangedFile = {
        path: "src/shared.ts",
        status: "M",
        isUncommitted: true,
      }

      const store = new DiffViewStore(workspacePath, branchFile, mockGitService as never)

      // Fetch branch version
      await store.fetchDiff(branchFile)
      expect(store.diff).toBe("branch diff")

      // Fetch uncommitted version - should not use cache
      await store.fetchDiff(uncommittedFile)
      expect(store.diff).toBe("uncommitted diff")

      // Both methods should have been called once
      expect(mockGitService.getFileDiff).toHaveBeenCalledTimes(1)
      expect(mockGitService.getUncommittedDiff).toHaveBeenCalledTimes(1)
    })

    it("caches uncommitted diffs separately", async () => {
      vi.mocked(mockGitService.getUncommittedDiff).mockResolvedValue("cached uncommitted diff")

      const store = new DiffViewStore(workspacePath, mockUncommittedFile, mockGitService as never)
      await store.fetchDiff(mockUncommittedFile)
      await store.fetchDiff(mockUncommittedFile)

      // Should only call once due to caching
      expect(mockGitService.getUncommittedDiff).toHaveBeenCalledTimes(1)
      expect(store.diff).toBe("cached uncommitted diff")
    })

    it("handles untracked files with isUncommitted flag", async () => {
      vi.mocked(mockGitService.getUncommittedDiff).mockResolvedValue("new file content")

      const store = new DiffViewStore(workspacePath, mockUntrackedFile, mockGitService as never)
      await store.fetchDiff(mockUntrackedFile)

      expect(mockGitService.getUncommittedDiff).toHaveBeenCalledWith(
        workspacePath,
        mockUntrackedFile.path,
        "?"
      )
      expect(store.diff).toBe("new file content")
    })

    it("handles errors when fetching uncommitted diff", async () => {
      vi.mocked(mockGitService.getUncommittedDiff).mockRejectedValue(
        new Error("Failed to get uncommitted diff")
      )

      const store = new DiffViewStore(workspacePath, mockUncommittedFile, mockGitService as never)
      await store.fetchDiff(mockUncommittedFile)

      expect(store.status).toBe("error")
      expect(store.errorMessage).toBe("Failed to get uncommitted diff")
    })
  })
})
