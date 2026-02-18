import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"

// Mock backend for approval commands
const mockBackendInvoke: Mock = vi.fn(() => Promise.resolve({ toolNames: [], commandPrefixes: [] }))
vi.mock("../../backend", () => ({
  backend: {
    invoke: (cmd: string, args: unknown) => mockBackendInvoke(cmd, args),
  },
}))

import { ProjectStore } from "../ProjectStore"
import type { Project, Workspace } from "../../types"

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: crypto.randomUUID(),
    projectId: "project-1",
    branch: "main",
    path: "/home/user/repo",
    isArchived: false,
    createdAt: new Date(),
    ...overrides,
  }
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "test-repo",
    path: "/home/user/repo",
    isGitRepo: true,
    workspaces: [],
    ...overrides,
  }
}

describe("ProjectStore", () => {
  it("initializes with repo data", () => {
    const repo = createProject({
      name: "my-repo",
      path: "/home/user/my-repo",
      initPrompt: "Hello",
      prPrompt: "PR template",
      postCreate: "pnpm install",
    })

    const store = new ProjectStore(repo)

    expect(store.id).toBe("project-1")
    expect(store.name).toBe("my-repo")
    expect(store.path).toBe("/home/user/my-repo")
    expect(store.initPrompt).toBe("Hello")
    expect(store.prPrompt).toBe("PR template")
    expect(store.postCreate).toBe("pnpm install")
  })

  it("activeWorkspaces filters out archived and archiving workspaces", () => {
    const repo = createProject({
      workspaces: [
        createWorkspace({ id: "wt-1", branch: "main", isArchived: false }),
        createWorkspace({ id: "wt-2", branch: "feature", isArchived: true }),
        createWorkspace({ id: "wt-3", branch: "dev", isArchived: false, isArchiving: true }),
        createWorkspace({ id: "wt-4", branch: "fix", isArchived: false }),
      ],
    })

    const store = new ProjectStore(repo)

    expect(store.activeWorkspaces).toHaveLength(2)
    expect(store.activeWorkspaces.map((wt) => wt.id)).toEqual(["wt-1", "wt-4"])
  })

  it("archivedWorkspaces returns only archived workspaces", () => {
    const repo = createProject({
      workspaces: [
        createWorkspace({ id: "wt-1", isArchived: false }),
        createWorkspace({ id: "wt-2", isArchived: true }),
        createWorkspace({ id: "wt-3", isArchived: true }),
      ],
    })

    const store = new ProjectStore(repo)

    expect(store.archivedWorkspaces).toHaveLength(2)
    expect(store.archivedWorkspaces.map((wt) => wt.id)).toEqual(["wt-2", "wt-3"])
  })

  it("hasWorkspaces returns true when workspaces exist", () => {
    const repoWithWorkspaces = createProject({
      workspaces: [createWorkspace()],
    })
    const repoWithoutWorkspaces = createProject({ workspaces: [] })

    expect(new ProjectStore(repoWithWorkspaces).hasWorkspaces).toBe(true)
    expect(new ProjectStore(repoWithoutWorkspaces).hasWorkspaces).toBe(false)
  })

  it("hasActiveWorkspaces returns true only when active workspaces exist", () => {
    const repoWithActive = createProject({
      workspaces: [createWorkspace({ isArchived: false })],
    })
    const repoWithOnlyArchived = createProject({
      workspaces: [createWorkspace({ isArchived: true })],
    })
    const repoEmpty = createProject({ workspaces: [] })

    expect(new ProjectStore(repoWithActive).hasActiveWorkspaces).toBe(true)
    expect(new ProjectStore(repoWithOnlyArchived).hasActiveWorkspaces).toBe(false)
    expect(new ProjectStore(repoEmpty).hasActiveWorkspaces).toBe(false)
  })

  it("getWorkspaceById finds workspace by ID", () => {
    const repo = createProject({
      workspaces: [
        createWorkspace({ id: "wt-1", branch: "main" }),
        createWorkspace({ id: "wt-2", branch: "feature" }),
      ],
    })

    const store = new ProjectStore(repo)

    expect(store.getWorkspaceById("wt-1")?.branch).toBe("main")
    expect(store.getWorkspaceById("wt-2")?.branch).toBe("feature")
    expect(store.getWorkspaceById("wt-nonexistent")).toBeUndefined()
  })

  it("getWorkspaceByPath finds workspace by path", () => {
    const repo = createProject({
      workspaces: [
        createWorkspace({ path: "/home/user/repo", branch: "main" }),
        createWorkspace({ path: "/home/user/repo-feature", branch: "feature" }),
      ],
    })

    const store = new ProjectStore(repo)

    expect(store.getWorkspaceByPath("/home/user/repo")?.branch).toBe("main")
    expect(store.getWorkspaceByPath("/home/user/repo-feature")?.branch).toBe("feature")
    expect(store.getWorkspaceByPath("/nonexistent")).toBeUndefined()
  })

  it("getWorkspaceByBranch finds workspace by branch name", () => {
    const repo = createProject({
      workspaces: [
        createWorkspace({ branch: "main", path: "/repo" }),
        createWorkspace({ branch: "feature", path: "/repo-feature" }),
      ],
    })

    const store = new ProjectStore(repo)

    expect(store.getWorkspaceByBranch("main")?.path).toBe("/repo")
    expect(store.getWorkspaceByBranch("feature")?.path).toBe("/repo-feature")
    expect(store.getWorkspaceByBranch("nonexistent")).toBeUndefined()
  })

  it("update modifies repo settings", () => {
    const repo = createProject({
      initPrompt: "old init",
      prPrompt: "old pr",
      postCreate: "old command",
    })

    const store = new ProjectStore(repo)

    store.update({ initPrompt: "new init" })
    expect(store.initPrompt).toBe("new init")
    expect(store.prPrompt).toBe("old pr")
    expect(store.postCreate).toBe("old command")

    store.update({ prPrompt: "new pr", postCreate: "new command" })
    expect(store.prPrompt).toBe("new pr")
    expect(store.postCreate).toBe("new command")
  })

  it("update clears settings when given empty string", () => {
    const repo = createProject({
      initPrompt: "some prompt",
      prPrompt: "some pr",
    })

    const store = new ProjectStore(repo)

    store.update({ initPrompt: "" })
    expect(store.initPrompt).toBeUndefined()
  })

  it("toProject returns plain Repo object", () => {
    const original = createProject({
      name: "test",
      path: "/test",
      workspaces: [createWorkspace({ id: "wt-1" })],
      initPrompt: "init",
      prPrompt: "pr",
      postCreate: "cmd",
    })

    const store = new ProjectStore(original)
    const exported = store.toProject()

    expect(exported).toEqual(original)
    expect(exported).not.toBe(store) // Should be a new object
  })

  describe("workspaceFilter", () => {
    it("initializes with workspaceFilter from repo", () => {
      const repo = createProject({
        workspaceFilter: "conductor|legacy",
      })

      const store = new ProjectStore(repo)

      expect(store.workspaceFilter).toBe("conductor|legacy")
    })

    it("activeWorkspaces applies regex filter to paths", () => {
      const repo = createProject({
        workspaceFilter: "conductor",
        workspaces: [
          createWorkspace({ id: "wt-1", path: "/home/user/repo", branch: "main" }),
          createWorkspace({ id: "wt-2", path: "/home/user/conductor/feature", branch: "feature" }),
          createWorkspace({ id: "wt-3", path: "/home/user/repo-dev", branch: "dev" }),
        ],
      })

      const store = new ProjectStore(repo)

      expect(store.activeWorkspaces).toHaveLength(2)
      expect(store.activeWorkspaces.map((wt) => wt.id)).toEqual(["wt-1", "wt-3"])
    })

    it("activeWorkspaces applies regex filter with multiple patterns", () => {
      const repo = createProject({
        workspaceFilter: "conductor|legacy",
        workspaces: [
          createWorkspace({ id: "wt-1", path: "/home/user/repo", branch: "main" }),
          createWorkspace({ id: "wt-2", path: "/home/user/conductor/feature", branch: "feature" }),
          createWorkspace({ id: "wt-3", path: "/home/user/legacy/old", branch: "old" }),
          createWorkspace({ id: "wt-4", path: "/home/user/repo-dev", branch: "dev" }),
        ],
      })

      const store = new ProjectStore(repo)

      expect(store.activeWorkspaces).toHaveLength(2)
      expect(store.activeWorkspaces.map((wt) => wt.id)).toEqual(["wt-1", "wt-4"])
    })

    it("activeWorkspaces ignores invalid regex and shows all workspaces", () => {
      const repo = createProject({
        workspaceFilter: "[invalid(regex",
        workspaces: [
          createWorkspace({ id: "wt-1", path: "/home/user/repo", branch: "main" }),
          createWorkspace({ id: "wt-2", path: "/home/user/feature", branch: "feature" }),
        ],
      })

      const store = new ProjectStore(repo)

      // Invalid regex should be ignored, so all active workspaces are shown
      expect(store.activeWorkspaces).toHaveLength(2)
    })

    it("activeWorkspaces works without workspaceFilter", () => {
      const repo = createProject({
        workspaces: [
          createWorkspace({ id: "wt-1", branch: "main" }),
          createWorkspace({ id: "wt-2", branch: "feature" }),
        ],
      })

      const store = new ProjectStore(repo)

      expect(store.activeWorkspaces).toHaveLength(2)
    })

    it("update modifies workspaceFilter", () => {
      const repo = createProject({
        workspaceFilter: "old-filter",
      })

      const store = new ProjectStore(repo)
      store.update({ workspaceFilter: "new-filter" })

      expect(store.workspaceFilter).toBe("new-filter")
    })

    it("update clears workspaceFilter when given empty string", () => {
      const repo = createProject({
        workspaceFilter: "some-filter",
      })

      const store = new ProjectStore(repo)
      store.update({ workspaceFilter: "" })

      expect(store.workspaceFilter).toBeUndefined()
    })

    it("toProject includes workspaceFilter", () => {
      const original = createProject({
        workspaceFilter: "test-filter",
      })

      const store = new ProjectStore(original)
      const exported = store.toProject()

      expect(exported.workspaceFilter).toBe("test-filter")
    })
  })

  describe("workspaceStores", () => {
    it("does not cache workspace store when workspace has empty path", () => {
      const repo = createProject({
        workspaces: [createWorkspace({ id: "wt-1", path: "" })],
      })

      const store = new ProjectStore(repo)

      // Access workspace store - should return a store but NOT cache it
      const ws1 = store.getWorkspaceStore("wt-1")
      expect(ws1).toBeDefined()

      // Should not be in cache since path is empty
      expect(store.workspaceStores).toHaveLength(0)
    })

    it("caches workspace store after path is set", () => {
      const repo = createProject({
        workspaces: [createWorkspace({ id: "wt-1", path: "/home/user/repo" })],
      })

      const store = new ProjectStore(repo)

      const ws1 = store.getWorkspaceStore("wt-1")
      expect(ws1).toBeDefined()

      // Should be in cache since path is set
      expect(store.workspaceStores).toHaveLength(1)
      expect(store.workspaceStores[0]).toBe(ws1)
    })

    it("returns empty array when no workspace stores are cached", () => {
      const repo = createProject({
        workspaces: [createWorkspace({ id: "wt-1" })],
      })

      const store = new ProjectStore(repo)

      expect(store.workspaceStores).toEqual([])
    })

    it("returns cached workspace stores after they are accessed", () => {
      const repo = createProject({
        workspaces: [
          createWorkspace({ id: "wt-1", branch: "main" }),
          createWorkspace({ id: "wt-2", branch: "feature" }),
        ],
      })

      const store = new ProjectStore(repo)

      // Access workspace stores to populate cache
      const ws1 = store.getWorkspaceStore("wt-1")
      const ws2 = store.getWorkspaceStore("wt-2")

      expect(store.workspaceStores).toHaveLength(2)
      expect(store.workspaceStores).toContain(ws1)
      expect(store.workspaceStores).toContain(ws2)
    })

    it("only returns accessed workspace stores", () => {
      const repo = createProject({
        workspaces: [
          createWorkspace({ id: "wt-1", branch: "main" }),
          createWorkspace({ id: "wt-2", branch: "feature" }),
          createWorkspace({ id: "wt-3", branch: "dev" }),
        ],
      })

      const store = new ProjectStore(repo)

      // Only access one workspace store
      store.getWorkspaceStore("wt-2")

      expect(store.workspaceStores).toHaveLength(1)
      expect(store.workspaceStores[0].branch).toBe("feature")
    })
  })

  describe("approval management", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("initializes with empty approval sets", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      expect(store.approvedToolNames.size).toBe(0)
      expect(store.approvedCommandPrefixes.size).toBe(0)
    })

    it("removeToolApproval removes tool from approved set", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      // Add some tools first
      store.approvedToolNames.add("Read")
      store.approvedToolNames.add("Write")
      expect(store.approvedToolNames.size).toBe(2)

      // Remove one
      store.removeToolApproval("Read")

      expect(store.approvedToolNames.has("Read")).toBe(false)
      expect(store.approvedToolNames.has("Write")).toBe(true)
      expect(store.approvedToolNames.size).toBe(1)
    })

    it("removeToolApproval handles non-existent tool gracefully", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      store.approvedToolNames.add("Read")

      // Remove non-existent tool - should not throw
      store.removeToolApproval("NonExistent")

      expect(store.approvedToolNames.has("Read")).toBe(true)
      expect(store.approvedToolNames.size).toBe(1)
    })

    it("removeCommandApproval removes command prefix from approved set", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      // Add some commands first
      store.approvedCommandPrefixes.add("cd")
      store.approvedCommandPrefixes.add("git status")
      store.approvedCommandPrefixes.add("pnpm install")
      expect(store.approvedCommandPrefixes.size).toBe(3)

      // Remove one
      store.removeCommandApproval("git status")

      expect(store.approvedCommandPrefixes.has("cd")).toBe(true)
      expect(store.approvedCommandPrefixes.has("git status")).toBe(false)
      expect(store.approvedCommandPrefixes.has("pnpm install")).toBe(true)
      expect(store.approvedCommandPrefixes.size).toBe(2)
    })

    it("removeCommandApproval handles non-existent command gracefully", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      store.approvedCommandPrefixes.add("cd")

      // Remove non-existent command - should not throw
      store.removeCommandApproval("git push")

      expect(store.approvedCommandPrefixes.has("cd")).toBe(true)
      expect(store.approvedCommandPrefixes.size).toBe(1)
    })

    it("clearAllApprovals clears both tools and commands", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      // Add approvals
      store.approvedToolNames.add("Read")
      store.approvedToolNames.add("Write")
      store.approvedCommandPrefixes.add("cd")
      store.approvedCommandPrefixes.add("git status")

      expect(store.approvedToolNames.size).toBe(2)
      expect(store.approvedCommandPrefixes.size).toBe(2)

      // Clear all
      store.clearAllApprovals()

      expect(store.approvedToolNames.size).toBe(0)
      expect(store.approvedCommandPrefixes.size).toBe(0)
    })

    it("clearAllApprovals works when already empty", () => {
      const repo = createProject()
      const store = new ProjectStore(repo)

      // Clear when already empty - should not throw
      store.clearAllApprovals()

      expect(store.approvedToolNames.size).toBe(0)
      expect(store.approvedCommandPrefixes.size).toBe(0)
    })

    describe("loadApprovals", () => {
      beforeEach(() => {
        mockBackendInvoke.mockClear()
      })

      it("loads approvals from backend", async () => {
        mockBackendInvoke.mockResolvedValueOnce({
          toolNames: ["Read", "Write"],
          commandPrefixes: ["cd", "git status"],
        })

        const repo = createProject({ name: "my-project" })
        const store = new ProjectStore(repo)

        await store.loadApprovals()

        expect(mockBackendInvoke).toHaveBeenCalledWith("load_project_approvals", {
          projectName: "my-project",
        })
        expect(store.approvedToolNames.has("Read")).toBe(true)
        expect(store.approvedToolNames.has("Write")).toBe(true)
        expect(store.approvedCommandPrefixes.has("cd")).toBe(true)
        expect(store.approvedCommandPrefixes.has("git status")).toBe(true)
      })

      it("does not load if already loaded", async () => {
        mockBackendInvoke.mockResolvedValueOnce({
          toolNames: ["Read"],
          commandPrefixes: [],
        })

        const repo = createProject()
        const store = new ProjectStore(repo)

        await store.loadApprovals()
        await store.loadApprovals() // Second call should be no-op

        expect(mockBackendInvoke).toHaveBeenCalledTimes(1)
      })

      it("handles backend error gracefully", async () => {
        mockBackendInvoke.mockRejectedValueOnce(new Error("Backend failed"))

        const repo = createProject()
        const store = new ProjectStore(repo)

        // Should not throw
        await store.loadApprovals()

        expect(store.approvedToolNames.size).toBe(0)
        expect(store.approvedCommandPrefixes.size).toBe(0)
      })

      it("handles empty response gracefully", async () => {
        mockBackendInvoke.mockResolvedValueOnce({
          toolNames: [],
          commandPrefixes: [],
        })

        const repo = createProject()
        const store = new ProjectStore(repo)

        // Should not throw
        await store.loadApprovals()

        expect(store.approvedToolNames.size).toBe(0)
        expect(store.approvedCommandPrefixes.size).toBe(0)
      })
    })

    describe("removeToolApproval", () => {
      it("removes tool from local set and calls backend", async () => {
        const repo = createProject({ name: "my-project" })
        const store = new ProjectStore(repo)

        store.approvedToolNames.add("Read")
        store.approvedToolNames.add("Write")

        await store.removeToolApproval("Read")

        expect(store.approvedToolNames.has("Read")).toBe(false)
        expect(store.approvedToolNames.has("Write")).toBe(true)
        expect(mockBackendInvoke).toHaveBeenCalledWith("remove_approval", {
          projectName: "my-project",
          toolOrPrefix: "Read",
          isPrefix: false,
        })
      })
    })

    describe("removeCommandApproval", () => {
      it("removes command from local set and calls backend", async () => {
        const repo = createProject({ name: "my-project" })
        const store = new ProjectStore(repo)

        store.approvedCommandPrefixes.add("cd")
        store.approvedCommandPrefixes.add("pnpm install")

        await store.removeCommandApproval("cd")

        expect(store.approvedCommandPrefixes.has("cd")).toBe(false)
        expect(store.approvedCommandPrefixes.has("pnpm install")).toBe(true)
        expect(mockBackendInvoke).toHaveBeenCalledWith("remove_approval", {
          projectName: "my-project",
          toolOrPrefix: "cd",
          isPrefix: true,
        })
      })
    })

    describe("clearAllApprovals", () => {
      it("clears local sets and calls backend", async () => {
        const repo = createProject({ name: "my-project" })
        const store = new ProjectStore(repo)

        store.approvedToolNames.add("Read")
        store.approvedCommandPrefixes.add("cd")

        await store.clearAllApprovals()

        expect(store.approvedToolNames.size).toBe(0)
        expect(store.approvedCommandPrefixes.size).toBe(0)
        expect(mockBackendInvoke).toHaveBeenCalledWith("clear_project_approvals", {
          projectName: "my-project",
        })
      })
    })
  })
})
