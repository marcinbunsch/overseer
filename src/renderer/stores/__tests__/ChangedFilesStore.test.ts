/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { ChangedFilesStore } from "../ChangedFilesStore"
import type { ChangedFile } from "../../types"

// Create a mock GitService instance
const mockGitService = {
  listChangedFiles: vi.fn(),
  getPrStatus: vi.fn(),
  checkMerge: vi.fn(),
  mergeIntoMain: vi.fn(),
  deleteBranch: vi.fn(),
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

// Create a mock workspace store
const mockWorkspaceStore = {
  sendMessage: vi.fn(),
  activeChats: [],
}

vi.mock("../ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspace: null,
    selectedWorkspaceStore: null,
    selectedProject: null,
    updateWorkspacePr: vi.fn(),
    archiveWorkspace: vi.fn(() => Promise.resolve()),
    switchToMainWorkspace: vi.fn(),
  },
}))

vi.mock("../ToastStore", () => ({
  toastStore: {
    show: vi.fn(),
  },
}))

// Mock eventBus - we need to track subscriptions
const mockEventBusListeners = new Map<string, Set<(payload: unknown) => void>>()
vi.mock("../../utils/eventBus", () => ({
  eventBus: {
    on: vi.fn((event: string, callback: (payload: unknown) => void) => {
      if (!mockEventBusListeners.has(event)) {
        mockEventBusListeners.set(event, new Set())
      }
      mockEventBusListeners.get(event)!.add(callback)
      return () => {
        mockEventBusListeners.get(event)?.delete(callback)
      }
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      const callbacks = mockEventBusListeners.get(event)
      if (callbacks) {
        for (const callback of callbacks) {
          callback(payload)
        }
      }
    }),
  },
}))

import { eventBus } from "../../utils/eventBus"

describe("ChangedFilesStore", () => {
  const workspacePath = "/tmp/workspace"
  const workspaceId = "wt-123"

  beforeEach(async () => {
    vi.clearAllMocks()
    mockEventBusListeners.clear()
    // Reset mock workspace store
    mockWorkspaceStore.sendMessage = vi.fn()
    mockWorkspaceStore.activeChats = []
    // Reset mock git service
    mockGitService.listChangedFiles = vi.fn()
    mockGitService.getPrStatus = vi.fn()
    mockGitService.checkMerge = vi.fn()
    mockGitService.mergeIntoMain = vi.fn()
    mockGitService.deleteBranch = vi.fn()
    // Set up projectRegistry with the mock workspace store
    const { projectRegistry } = await import("../ProjectRegistry")
    vi.mocked(projectRegistry).selectedWorkspaceStore = mockWorkspaceStore as never
  })

  it("initializes with empty state", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    expect(store.files).toEqual([])
    expect(store.uncommitted).toEqual([])
    expect(store.isDefaultBranch).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.checking).toBe(false)
    expect(store.merging).toBe(false)
    expect(store.showMergeConfirm).toBe(false)
    expect(store.diffFile).toBeNull()
    expect(store.prStatus).toBeNull()
    expect(store.prLoading).toBe(false)
  })

  it("refresh fetches changed files and updates state", async () => {
    const mockBranchFiles: ChangedFile[] = [
      { path: "src/foo.ts", status: "M" },
      { path: "src/bar.ts", status: "A" },
    ]
    const mockUncommittedFiles: ChangedFile[] = [{ path: "src/new.ts", status: "?" }]
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: mockBranchFiles,
      uncommitted: mockUncommittedFiles,
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.refresh()

    expect(mockGitService.listChangedFiles).toHaveBeenCalledWith(workspacePath)
    expect(store.files).toEqual(mockBranchFiles)
    // Uncommitted files should have isUncommitted flag set
    expect(store.uncommitted).toEqual([{ path: "src/new.ts", status: "?", isUncommitted: true }])
    expect(store.isDefaultBranch).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it("refresh sets error on failure", async () => {
    vi.mocked(mockGitService.listChangedFiles).mockRejectedValue(new Error("Git error"))

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.refresh()

    expect(store.error).toBe("Git error")
    expect(store.loading).toBe(false)
    expect(store.files).toEqual([])
  })

  it("refresh sets isDefaultBranch correctly", async () => {
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: true,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.refresh()

    expect(store.isDefaultBranch).toBe(true)
  })

  it("setDiffFile updates diffFile", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    const file: ChangedFile = { path: "test.ts", status: "M" }

    store.setDiffFile(file)
    expect(store.diffFile).toEqual(file)

    store.setDiffFile(null)
    expect(store.diffFile).toBeNull()
  })

  it("openReview sets diffFile to first uncommitted file", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    const uncommittedFile: ChangedFile = {
      path: "uncommitted.ts",
      status: "M",
      isUncommitted: true,
    }
    const branchFile: ChangedFile = { path: "branch.ts", status: "A" }

    // Manually set the files (normally done via refresh)
    store["uncommitted"] = [uncommittedFile]
    store["files"] = [branchFile]

    store.openReview()
    expect(store.diffFile).toEqual(uncommittedFile)
  })

  it("openReview falls back to first branch file when no uncommitted", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    const branchFile: ChangedFile = { path: "branch.ts", status: "A" }

    store["uncommitted"] = []
    store["files"] = [branchFile]

    store.openReview()
    expect(store.diffFile).toEqual(branchFile)
  })

  it("openReview does nothing when no files", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    store["uncommitted"] = []
    store["files"] = []

    store.openReview()
    expect(store.diffFile).toBeNull()
  })

  it("setShowMergeConfirm updates showMergeConfirm", () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    store.setShowMergeConfirm(true)
    expect(store.showMergeConfirm).toBe(true)

    store.setShowMergeConfirm(false)
    expect(store.showMergeConfirm).toBe(false)
  })

  it("checkMerge shows merge confirm on success", async () => {
    vi.mocked(mockGitService.checkMerge).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.checkMerge()

    expect(store.showMergeConfirm).toBe(true)
    expect(store.checking).toBe(false)
  })

  it("checkMerge sends message on conflicts", async () => {
    vi.mocked(mockGitService.checkMerge).mockResolvedValue({
      success: false,
      conflicts: ["file1.ts", "file2.ts"],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.checkMerge()

    expect(mockWorkspaceStore.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("file1.ts, file2.ts")
    )
    expect(store.showMergeConfirm).toBe(false)
  })

  it("checkMerge sets error on failure message", async () => {
    vi.mocked(mockGitService.checkMerge).mockResolvedValue({
      success: false,
      conflicts: [],
      message: "Branch not found",
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.checkMerge()

    expect(store.error).toBe("Branch not found")
  })

  it("merge shows toast and refreshes on success", async () => {
    const { toastStore } = await import("../ToastStore")
    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    store.showMergeConfirm = true

    await store.merge(false, false)

    expect(toastStore.show).toHaveBeenCalledWith("Branch merged successfully")
    expect(store.showMergeConfirm).toBe(false)
    expect(store.merging).toBe(false)
  })

  it("merge archives workspace when archiveAfter is true", async () => {
    const { projectRegistry } = await import("../ProjectRegistry")
    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(true, false)

    expect(projectRegistry.archiveWorkspace).toHaveBeenCalledWith(workspaceId)
  })

  it("merge shows 'workspace archived' toast when archiving", async () => {
    const { toastStore } = await import("../ToastStore")
    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(true, false)

    expect(toastStore.show).toHaveBeenCalledWith("Branch merged and workspace archived")
  })

  it("merge deletes branch when deleteBranch is true and archive succeeds", async () => {
    const { projectRegistry } = await import("../ProjectRegistry")
    const { toastStore } = await import("../ToastStore")

    // Set up selected workspace and repo
    vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never
    vi.mocked(projectRegistry).selectedProject = { id: "repo-1", path: "/repo/path" } as never

    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })
    vi.mocked(mockGitService.deleteBranch).mockResolvedValue(undefined)

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(true, true)

    expect(mockGitService.deleteBranch).toHaveBeenCalledWith("/repo/path", "feature-branch")
    expect(toastStore.show).toHaveBeenCalledWith(
      "Branch merged, workspace archived, and branch deleted"
    )
  })

  it("merge does not delete branch when deleteBranch is false", async () => {
    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(true, false)

    expect(mockGitService.deleteBranch).not.toHaveBeenCalled()
  })

  it("merge switches to main workspace after successful merge", async () => {
    const { projectRegistry } = await import("../ProjectRegistry")

    vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never
    vi.mocked(projectRegistry).selectedProject = { id: "repo-1", path: "/repo/path" } as never

    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(false, false)

    expect(projectRegistry.switchToMainWorkspace).toHaveBeenCalledWith("repo-1")
  })

  it("merge still succeeds if branch deletion fails", async () => {
    const { projectRegistry } = await import("../ProjectRegistry")
    const { toastStore } = await import("../ToastStore")

    vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never
    vi.mocked(projectRegistry).selectedProject = { id: "repo-1", path: "/repo/path" } as never

    vi.mocked(mockGitService.mergeIntoMain).mockResolvedValue({
      success: true,
      conflicts: [],
      message: "",
    })
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })
    vi.mocked(mockGitService.deleteBranch).mockRejectedValue(new Error("Branch not merged"))

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
    await store.merge(true, true)

    // Should still show archive success even if branch deletion fails
    expect(toastStore.show).toHaveBeenCalledWith("Branch merged and workspace archived")
    expect(store.merging).toBe(false)
    expect(store.error).toBeNull()
  })

  it("onRunningCountChange triggers refresh when count drops to 0", async () => {
    vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
      files: [],
      uncommitted: [],
      is_default_branch: false,
      submodules: [],
    })

    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    // Simulate chat finishing: was 1, now 0
    store.onRunningCountChange(1)
    store.onRunningCountChange(0)

    // Wait for the delayed refresh
    await vi.waitFor(
      () => {
        expect(mockGitService.listChangedFiles).toHaveBeenCalled()
      },
      { timeout: 600 }
    )
  })

  it("onRunningCountChange does not refresh when count stays at 0", async () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    store.onRunningCountChange(0)
    store.onRunningCountChange(0)

    // Short wait to ensure no refresh happens
    await new Promise((r) => setTimeout(r, 100))
    expect(mockGitService.listChangedFiles).not.toHaveBeenCalled()
  })

  it("dispose clears unlisteners", async () => {
    const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

    // Simulate having listeners
    const mockUnlisten = vi.fn()
    // @ts-expect-error - accessing private property for testing
    store.unlisteners = [mockUnlisten]

    store.dispose()

    expect(mockUnlisten).toHaveBeenCalled()
    // @ts-expect-error - accessing private property for testing
    expect(store.unlisteners).toEqual([])
  })

  describe("computed properties", () => {
    it("totalFileCount returns sum of uncommitted and branch files", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [
          { path: "src/a.ts", status: "M" },
          { path: "src/b.ts", status: "A" },
        ],
        uncommitted: [
          { path: "src/c.ts", status: "M" },
          { path: "src/d.ts", status: "?" },
          { path: "src/e.ts", status: "A" },
        ],
        is_default_branch: false,
        submodules: [],
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      await store.refresh()

      expect(store.totalFileCount).toBe(5)
    })

    it("totalFileCount returns 0 when no files", () => {
      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

      expect(store.totalFileCount).toBe(0)
    })

    it("allFiles combines uncommitted and branch files in order", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [
          { path: "src/branch-a.ts", status: "M" },
          { path: "src/branch-b.ts", status: "A" },
        ],
        uncommitted: [
          { path: "src/uncommitted-a.ts", status: "M" },
          { path: "src/uncommitted-b.ts", status: "?" },
        ],
        is_default_branch: false,
        submodules: [],
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      await store.refresh()

      expect(store.allFiles).toHaveLength(4)
      // Uncommitted files come first
      expect(store.allFiles[0].path).toBe("src/uncommitted-a.ts")
      expect(store.allFiles[0].isUncommitted).toBe(true)
      expect(store.allFiles[1].path).toBe("src/uncommitted-b.ts")
      expect(store.allFiles[1].isUncommitted).toBe(true)
      // Then branch files
      expect(store.allFiles[2].path).toBe("src/branch-a.ts")
      expect(store.allFiles[2].isUncommitted).toBeUndefined()
      expect(store.allFiles[3].path).toBe("src/branch-b.ts")
      expect(store.allFiles[3].isUncommitted).toBeUndefined()
    })

    it("allFiles returns empty array when no files", () => {
      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)

      expect(store.allFiles).toEqual([])
    })

    it("uncommitted files have isUncommitted flag set to true", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [
          { path: "src/new.ts", status: "M" },
          { path: "src/untracked.ts", status: "?" },
        ],
        is_default_branch: false,
        submodules: [],
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      await store.refresh()

      expect(store.uncommitted).toHaveLength(2)
      expect(store.uncommitted[0].isUncommitted).toBe(true)
      expect(store.uncommitted[1].isUncommitted).toBe(true)
    })
  })

  describe("overseer action event listeners", () => {
    it("activate subscribes to overseer:open_pr event", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      expect(eventBus.on).toHaveBeenCalledWith("overseer:open_pr", expect.any(Function))
    })

    it("activate subscribes to overseer:merge_branch event", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      expect(eventBus.on).toHaveBeenCalledWith("overseer:merge_branch", expect.any(Function))
    })

    it("overseer:open_pr event triggers createPR", async () => {
      const { projectRegistry } = await import("../ProjectRegistry")

      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never
      vi.mocked(projectRegistry).selectedProject = { id: "repo-1", prPrompt: null } as never

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      // Emit the event via mock
      eventBus.emit("overseer:open_pr", { title: "My PR" })

      // createPR should have been triggered, which calls workspaceStore.sendMessage
      expect(mockWorkspaceStore.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("create a GitHub pull request"),
        expect.objectContaining({ type: "create-pr" })
      )
    })

    it("overseer:merge_branch event triggers checkMerge", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(mockGitService.checkMerge).mockResolvedValue({
        success: true,
        conflicts: [],
        message: "",
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      // Emit the event
      eventBus.emit("overseer:merge_branch", { into: "main" })

      // Wait for checkMerge to be called
      await vi.waitFor(() => {
        expect(mockGitService.checkMerge).toHaveBeenCalledWith(workspacePath)
      })
    })

    it("dispose unsubscribes from overseer events", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      // Verify subscriptions exist
      expect(mockEventBusListeners.get("overseer:open_pr")?.size).toBe(1)
      expect(mockEventBusListeners.get("overseer:merge_branch")?.size).toBe(1)

      store.dispose()

      // Verify subscriptions are removed
      expect(mockEventBusListeners.get("overseer:open_pr")?.size).toBe(0)
      expect(mockEventBusListeners.get("overseer:merge_branch")?.size).toBe(0)
    })

    it("events are not processed after dispose", async () => {
      const { projectRegistry } = await import("../ProjectRegistry")

      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()
      store.dispose()

      // Clear mocks after dispose
      mockWorkspaceStore.sendMessage.mockClear()
      vi.mocked(mockGitService.checkMerge).mockClear()

      // Try to emit events - they should not be processed
      eventBus.emit("overseer:open_pr", { title: "My PR" })
      eventBus.emit("overseer:merge_branch", { into: "main" })

      // Nothing should have been called
      expect(mockWorkspaceStore.sendMessage).not.toHaveBeenCalled()
      expect(mockGitService.checkMerge).not.toHaveBeenCalled()
    })

    it("createPR includes repo prPrompt when available", async () => {
      const { projectRegistry } = await import("../ProjectRegistry")

      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(projectRegistry).selectedWorkspace = { branch: "feature-branch" } as never
      vi.mocked(projectRegistry).selectedProject = {
        id: "repo-1",
        prPrompt: "Always include a test plan",
      } as never

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      eventBus.emit("overseer:open_pr", { title: "My PR" })

      expect(mockWorkspaceStore.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining("Always include a test plan"),
        expect.any(Object)
      )
    })

    it("checkMerge shows merge confirm dialog on success", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(mockGitService.checkMerge).mockResolvedValue({
        success: true,
        conflicts: [],
        message: "",
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      eventBus.emit("overseer:merge_branch", { into: "main" })

      await vi.waitFor(() => {
        expect(store.showMergeConfirm).toBe(true)
      })
    })

    it("checkMerge sends conflict message when conflicts exist", async () => {
      vi.mocked(mockGitService.listChangedFiles).mockResolvedValue({
        files: [],
        uncommitted: [],
        is_default_branch: false,
        submodules: [],
      })
      vi.mocked(mockGitService.getPrStatus).mockResolvedValue(null)
      vi.mocked(mockGitService.checkMerge).mockResolvedValue({
        success: false,
        conflicts: ["file1.ts", "file2.ts"],
        message: "",
      })

      const store = new ChangedFilesStore(workspacePath, workspaceId, mockGitService as never)
      store.activate()

      // Clear any previous calls from activate
      mockWorkspaceStore.sendMessage.mockClear()

      eventBus.emit("overseer:merge_branch", { into: "main" })

      await vi.waitFor(() => {
        expect(mockWorkspaceStore.sendMessage).toHaveBeenCalledWith(
          expect.stringContaining("file1.ts, file2.ts")
        )
      })
    })
  })
})
