import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommitsStore } from "../CommitsStore"

// Mock the git service
vi.mock("../../services/git", () => ({
  gitService: {
    listCommits: vi.fn(),
  },
}))

// Mock the backend
vi.mock("../../backend", () => ({
  backend: {
    listen: vi.fn().mockResolvedValue(() => {}),
  },
}))

// Mock the project registry
vi.mock("../ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspaceStore: {
      activeChats: [],
    },
  },
}))

import { gitService } from "../../services/git"

describe("CommitsStore", () => {
  let store: CommitsStore

  beforeEach(() => {
    vi.clearAllMocks()
    store = new CommitsStore("/test/workspace")
  })

  describe("initial state", () => {
    it("should start with empty commits", () => {
      expect(store.commits).toEqual([])
    })

    it("should start not loading", () => {
      expect(store.loading).toBe(false)
    })

    it("should have no error", () => {
      expect(store.error).toBeNull()
    })

    it("should have no diff commit", () => {
      expect(store.diffCommit).toBeNull()
    })
  })

  describe("refresh", () => {
    it("should load commits from git service", async () => {
      const mockCommits = [
        { shortId: "abc1234", message: "First commit" },
        { shortId: "def5678", message: "Second commit" },
      ]
      vi.mocked(gitService.listCommits).mockResolvedValue(mockCommits)

      await store.refresh()

      expect(gitService.listCommits).toHaveBeenCalledWith("/test/workspace")
      expect(store.commits).toEqual(mockCommits)
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it("should handle errors", async () => {
      vi.mocked(gitService.listCommits).mockRejectedValue(new Error("Git failed"))

      await store.refresh()

      expect(store.error).toBe("Git failed")
      expect(store.commits).toEqual([])
      expect(store.loading).toBe(false)
    })

    it("should set loading during fetch", async () => {
      let resolvePromise: (value: unknown) => void
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      vi.mocked(gitService.listCommits).mockReturnValue(pendingPromise as Promise<never>)

      const refreshPromise = store.refresh()
      expect(store.loading).toBe(true)

      resolvePromise!([])
      await refreshPromise
      expect(store.loading).toBe(false)
    })
  })

  describe("setDiffCommit", () => {
    it("should set the diff commit", () => {
      const commit = { shortId: "abc1234", message: "Test commit" }
      store.setDiffCommit(commit)
      expect(store.diffCommit).toEqual(commit)
    })

    it("should clear the diff commit with null", () => {
      store.setDiffCommit({ shortId: "abc1234", message: "Test" })
      store.setDiffCommit(null)
      expect(store.diffCommit).toBeNull()
    })
  })

  describe("onRunningCountChange", () => {
    it("should trigger refresh when running count goes from positive to zero", () => {
      vi.useFakeTimers()
      const mockCommits = [{ shortId: "abc1234", message: "Test" }]
      vi.mocked(gitService.listCommits).mockResolvedValue(mockCommits)

      // Simulate a running chat
      store.onRunningCountChange(1)
      expect(gitService.listCommits).not.toHaveBeenCalled()

      // Chat finishes
      store.onRunningCountChange(0)

      // Advance timers to trigger the delayed refresh
      vi.advanceTimersByTime(500)
      expect(gitService.listCommits).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it("should not trigger refresh when running count increases", () => {
      store.onRunningCountChange(0)
      store.onRunningCountChange(1)
      store.onRunningCountChange(2)
      expect(gitService.listCommits).not.toHaveBeenCalled()
    })
  })
})
