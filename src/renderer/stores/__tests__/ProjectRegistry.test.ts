import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

// Mock git and terminal services to avoid their own Tauri dependencies
vi.mock("../../services/git", () => ({
  gitService: {
    listWorkspaces: vi.fn(() => Promise.resolve([])),
    addWorkspace: vi.fn(() => Promise.resolve("/tmp/workspace")),
    archiveWorkspace: vi.fn(() => Promise.resolve()),
    renameBranch: vi.fn(() => Promise.resolve()),
    deleteBranch: vi.fn(() => Promise.resolve()),
    isGitRepo: vi.fn(() => Promise.resolve(true)),
  },
}))

vi.mock("../../services/terminal", () => ({
  terminalService: {
    destroy: vi.fn(),
    write: vi.fn(),
    getOrCreate: vi.fn(() => Promise.resolve({})),
    waitForReady: vi.fn(() => Promise.resolve()),
  },
}))

// WorkspaceStore is now created per-workspace via ProjectStore
// Mock the WorkspaceStore module
vi.mock("../WorkspaceStore", () => ({
  WorkspaceStore: vi.fn().mockImplementation(() => ({
    load: vi.fn(() => Promise.resolve()),
    archiveChatFolder: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
    activeChats: [],
    activeChatId: null,
  })),
}))

// Mock the WorkspaceHistoryStore to avoid side effects
vi.mock("../WorkspaceHistoryStore", () => ({
  workspaceHistoryStore: {
    push: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    canGoBack: false,
    canGoForward: false,
  },
}))

describe("ProjectRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_project_registry") return Promise.resolve({ projects: [] })
      if (cmd === "save_project_registry") return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })
  })

  it("initializes with empty repos", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    // Wait for loadFromFile to complete
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    expect(projectRegistry.projects).toEqual([])
    expect(projectRegistry.selectedProjectId).toBeNull()
    expect(projectRegistry.selectedWorkspaceId).toBeNull()
  })

  it("loads repos from file on construction", async () => {
    const savedRepos = [
      {
        id: "repo-1",
        name: "myrepo",
        path: "/home/testuser/myrepo",
        workspaces: [
          {
            id: "wt-1",
            projectId: "repo-1",
            branch: "main",
            path: "/home/testuser/myrepo",
            isArchived: false,
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
    ]

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_project_registry") return Promise.resolve({ projects: savedRepos })
      if (cmd === "save_project_registry") return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })

    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    await vi.waitFor(() => {
      expect(projectRegistry.projects).toHaveLength(1)
    })

    expect(projectRegistry.projects[0].name).toBe("myrepo")
    expect(projectRegistry.projects[0].workspaces).toHaveLength(1)
  })

  it("loads projects from projects.json from projects key", async () => {
    const savedRepos = {
      projects: [
        {
          id: "repo-1",
          name: "myrepo",
          path: "/home/testuser/myrepo",
          workspaces: [
            {
              id: "wt-1",
              projectId: "repo-1",
              branch: "main",
              path: "/home/testuser/myrepo",
              isArchived: false,
              createdAt: "2024-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    }

    vi.mocked(exists)
      .mockResolvedValueOnce(true) // configDir
      .mockResolvedValueOnce(true) // configPath
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(savedRepos))

    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    await vi.waitFor(() => {
      expect(projectRegistry.projects).toHaveLength(1)
    })

    expect(projectRegistry.projects[0].name).toBe("myrepo")
    expect(projectRegistry.projects[0].workspaces).toHaveLength(1)
  })

  it("selectProject sets selectedProjectId and clears workspace", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    projectRegistry.selectProject("repo-1")
    expect(projectRegistry.selectedProjectId).toBe("repo-1")
    expect(projectRegistry.selectedWorkspaceId).toBeNull()
  })

  it("selectWorkspace sets selectedWorkspaceId", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    projectRegistry.selectWorkspace("wt-1")
    expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
  })

  it("removeProject removes the repo and clears selection if active", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")
    const { runInAction } = await import("mobx")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    runInAction(() => {
      projectRegistry.setProjects([
        { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        { id: "repo-2", name: "other", path: "/other", isGitRepo: true, workspaces: [] },
      ])
      projectRegistry.selectedProjectId = "repo-1"
    })

    projectRegistry.removeProject("repo-1")

    expect(projectRegistry.projects).toHaveLength(1)
    expect(projectRegistry.projects[0].id).toBe("repo-2")
    expect(projectRegistry.selectedProjectId).toBeNull()
  })

  it("removeProject does not clear selection if different repo removed", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")
    const { runInAction } = await import("mobx")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    runInAction(() => {
      projectRegistry.setProjects([
        { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        { id: "repo-2", name: "other", path: "/other", isGitRepo: true, workspaces: [] },
      ])
      projectRegistry.selectedProjectId = "repo-1"
    })

    projectRegistry.removeProject("repo-2")

    expect(projectRegistry.selectedProjectId).toBe("repo-1")
  })

  it("selectedProject computed returns the correct repo", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")
    const { runInAction } = await import("mobx")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    runInAction(() => {
      projectRegistry.setProjects([
        { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
      ])
      projectRegistry.selectedProjectId = "repo-1"
    })

    expect(projectRegistry.selectedProject?.name).toBe("test")
  })

  it("selectedProject returns undefined when no repo selected", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    expect(projectRegistry.selectedProject).toBeUndefined()
  })

  it("addProject calls gitService.listWorkspaces and adds repo", async () => {
    vi.resetModules()
    const { projectRegistry } = await import("../ProjectRegistry")
    const { gitService } = await import("../../services/git")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
    })

    vi.mocked(gitService.listWorkspaces).mockResolvedValue([
      { path: "/home/user/myrepo", branch: "main" },
    ])

    await projectRegistry.addProject("/home/user/myrepo")

    expect(gitService.listWorkspaces).toHaveBeenCalledWith("/home/user/myrepo")
    expect(projectRegistry.projects).toHaveLength(1)
    expect(projectRegistry.projects[0].name).toBe("myrepo")
    expect(projectRegistry.projects[0].workspaces).toHaveLength(1)
    expect(projectRegistry.projects[0].workspaces[0].branch).toBe("main")
  })

  describe("ProjectStore cache", () => {
    it("returns ProjectStore instances from repos computed", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { ProjectStore } = await import("../ProjectStore")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      expect(projectRegistry.projects[0]).toBeInstanceOf(ProjectStore)
    })

    it("maintains referential stability for ProjectStore instances", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      const firstAccess = projectRegistry.projects[0]
      const secondAccess = projectRegistry.projects[0]

      expect(firstAccess).toBe(secondAccess)
    })

    it("clears cache when repo is removed", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test1", path: "/test1", isGitRepo: true, workspaces: [] },
          { id: "repo-2", name: "test2", path: "/test2", isGitRepo: true, workspaces: [] },
        ])
      })

      const repo1Before = projectRegistry.projects[0]
      expect(repo1Before.id).toBe("repo-1")

      projectRegistry.removeProject("repo-1")

      expect(projectRegistry.projects).toHaveLength(1)
      expect(projectRegistry.projects[0].id).toBe("repo-2")
    })

    it("clears cache when setProjects is called", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      const firstInstance = projectRegistry.projects[0]

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test-updated", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      const secondInstance = projectRegistry.projects[0]

      // After setProjects, cache is cleared so new instance is created
      expect(firstInstance).not.toBe(secondInstance)
      expect(secondInstance.name).toBe("test-updated")
    })

    it("syncs workspaces to ProjectStore when adding a workspace", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.addWorkspace).mockResolvedValue("/test/feature")

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      // Access repos to populate cache
      const repoStore = projectRegistry.projects[0]
      expect(repoStore.workspaces).toHaveLength(0)

      await projectRegistry.addWorkspace("repo-1", "feature")

      // ProjectStore should be updated with new workspace
      expect(repoStore.workspaces).toHaveLength(1)
      expect(repoStore.workspaces[0].branch).toBe("feature")
    })

    it("syncs settings to ProjectStore when updateProject is called", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      // Access repos to populate cache
      const repoStore = projectRegistry.projects[0]
      expect(repoStore.initPrompt).toBeUndefined()

      projectRegistry.updateProject("repo-1", { initPrompt: "Hello", workspaceFilter: "conductor" })

      // ProjectStore should be updated
      expect(repoStore.initPrompt).toBe("Hello")
      expect(repoStore.workspaceFilter).toBe("conductor")
    })
  })

  describe("switchToMainWorkspace", () => {
    it("switches to main branch workspace", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-2"
      })

      projectRegistry.switchToMainWorkspace("repo-1")

      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })

    it("switches to master branch workspace", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "master",
                path: "/test",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-2"
      })

      projectRegistry.switchToMainWorkspace("repo-1")

      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })

    it("does nothing if main workspace is archived", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test",
                isArchived: true,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-2"
      })

      projectRegistry.switchToMainWorkspace("repo-1")

      expect(projectRegistry.selectedWorkspaceId).toBe("wt-2")
    })

    it("does nothing if repo not found", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([])
        projectRegistry.selectedWorkspaceId = "wt-2"
      })

      projectRegistry.switchToMainWorkspace("nonexistent")

      expect(projectRegistry.selectedWorkspaceId).toBe("wt-2")
    })
  })

  describe("archiveWorkspace with deleteBranch", () => {
    it("deletes branch when deleteBranch is true", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "feature-branch",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      await projectRegistry.archiveWorkspace("wt-1", true)

      expect(gitService.deleteBranch).toHaveBeenCalledWith("/test", "feature-branch")
    })

    it("does not delete branch when deleteBranch is false", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "feature-branch",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      await projectRegistry.archiveWorkspace("wt-1", false)

      expect(gitService.deleteBranch).not.toHaveBeenCalled()
    })

    it("does not delete branch by default", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "feature-branch",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      await projectRegistry.archiveWorkspace("wt-1")

      expect(gitService.deleteBranch).not.toHaveBeenCalled()
    })

    it("still archives successfully if branch deletion fails", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.deleteBranch).mockRejectedValue(new Error("Branch not found"))

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "feature-branch",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      await projectRegistry.archiveWorkspace("wt-1", true)

      // Should still mark as archived
      expect(projectRegistry.projects[0].workspaces[0].isArchived).toBe(true)
    })
  })

  describe("persistence timing", () => {
    it("addProject awaits saveToFile before returning", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.listWorkspaces).mockResolvedValue([
        { path: "/home/user/myrepo", branch: "main" },
      ])

      // Track when save_project_registry completes
      let writeCompleted = false
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "load_project_registry") return Promise.resolve({ projects: [] })
        if (cmd === "save_project_registry") {
          return new Promise((resolve) => {
            setTimeout(() => {
              writeCompleted = true
              resolve(undefined)
            }, 10)
          })
        }
        return Promise.resolve(undefined)
      })

      await projectRegistry.addProject("/home/user/myrepo")

      // After addProject returns, save should have completed
      expect(writeCompleted).toBe(true)
      expect(invoke).toHaveBeenCalledWith("save_project_registry", expect.anything())
    })

    it("addWorkspace triggers saveToFile without blocking", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.addWorkspace).mockResolvedValue("/test/feature")

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      await projectRegistry.addWorkspace("repo-1", "feature")

      // Save is fire-and-forget, so we wait for it to be called
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("save_project_registry", expect.anything())
      })
    })
  })

  describe("addWorkspace postCreate", () => {
    it("executes postCreate script via terminal.write when provided", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { terminalService } = await import("../../services/terminal")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.addWorkspace).mockResolvedValue("/test/feature")

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [],
            postCreate: "pnpm install",
          },
        ])
      })

      await projectRegistry.addWorkspace("repo-1", "feature")

      // postCreate runs fire-and-forget, so wait for it to complete
      await vi.waitFor(() => {
        // Should get or create terminal for the workspace (with project root)
        expect(terminalService.getOrCreate).toHaveBeenCalledWith("/test/feature", "/test")

        // Should wait for the shell to be ready
        expect(terminalService.waitForReady).toHaveBeenCalledWith("/test/feature")

        // Should write the postCreate script to the terminal
        expect(terminalService.write).toHaveBeenCalledWith("/test/feature", "pnpm install\n")
      })
    })

    it("does not write to terminal when no postCreate script", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { gitService } = await import("../../services/git")
      const { terminalService } = await import("../../services/terminal")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      vi.mocked(gitService.addWorkspace).mockResolvedValue("/test/feature")

      runInAction(() => {
        projectRegistry.setProjects([
          { id: "repo-1", name: "test", path: "/test", isGitRepo: true, workspaces: [] },
        ])
      })

      await projectRegistry.addWorkspace("repo-1", "feature")

      // Should not get terminal, wait, or write
      expect(terminalService.getOrCreate).not.toHaveBeenCalled()
      expect(terminalService.waitForReady).not.toHaveBeenCalled()
      expect(terminalService.write).not.toHaveBeenCalled()
    })
  })

  describe("selectPreviousWorkspace and selectNextWorkspace", () => {
    it("skips filtered workspaces when navigating", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaceFilter: "ignored", // Filter out paths containing "ignored"
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "ignored-branch",
                path: "/test/ignored", // This matches workspaceFilter
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-3",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      // Navigate next from wt-1 should skip wt-2 (filtered) and go to wt-3
      projectRegistry.selectNextWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-3")

      // Navigate next from wt-3 should wrap to wt-1
      projectRegistry.selectNextWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")

      // Navigate previous from wt-1 should wrap to wt-3, skipping wt-2
      projectRegistry.selectPreviousWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-3")
    })

    it("navigates correctly when no filter is set", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      projectRegistry.selectNextWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-2")

      projectRegistry.selectPreviousWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })

    it("skips archived workspaces", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "archived",
                path: "/test/archived",
                isArchived: true, // Archived
                createdAt: new Date(),
              },
              {
                id: "wt-3",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      // Navigate next from wt-1 should skip wt-2 (archived) and go to wt-3
      projectRegistry.selectNextWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-3")
    })

    it("does nothing when no workspaces available", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = null
      })

      projectRegistry.selectNextWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBeNull()

      projectRegistry.selectPreviousWorkspace()
      expect(projectRegistry.selectedWorkspaceId).toBeNull()
    })
  })

  describe("goBackInHistory and goForwardInHistory", () => {
    it("goBackInHistory navigates to previous workspace from history", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-2"
      })

      vi.mocked(workspaceHistoryStore.goBack).mockReturnValue("wt-1")

      projectRegistry.goBackInHistory()

      expect(workspaceHistoryStore.goBack).toHaveBeenCalled()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })

    it("goBackInHistory does nothing when no history", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      vi.mocked(workspaceHistoryStore.goBack).mockReturnValue(null)

      projectRegistry.goBackInHistory()

      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })

    it("goForwardInHistory navigates to next workspace from history", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "feature",
                path: "/test/feature",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      vi.mocked(workspaceHistoryStore.goForward).mockReturnValue("wt-2")

      projectRegistry.goForwardInHistory()

      expect(workspaceHistoryStore.goForward).toHaveBeenCalled()
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-2")
    })

    it("goBackInHistory skips archived workspaces", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test/main",
                isArchived: false,
                createdAt: new Date(),
              },
              {
                id: "wt-2",
                projectId: "repo-1",
                branch: "archived",
                path: "/test/archived",
                isArchived: true,
                createdAt: new Date(),
              },
            ],
          },
        ])
        projectRegistry.selectedProjectId = "repo-1"
        projectRegistry.selectedWorkspaceId = "wt-1"
      })

      // First call returns archived workspace, second call returns valid one
      vi.mocked(workspaceHistoryStore.goBack)
        .mockReturnValueOnce("wt-2") // Archived
        .mockReturnValueOnce("wt-1") // Valid

      projectRegistry.goBackInHistory()

      // Should have called goBack twice (once for archived, once for valid)
      expect(workspaceHistoryStore.goBack).toHaveBeenCalledTimes(2)
      expect(projectRegistry.selectedWorkspaceId).toBe("wt-1")
    })
  })

  describe("hasRunningChats", () => {
    it("returns false when no projects exist", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      expect(projectRegistry.hasRunningChats()).toBe(false)
    })

    it("returns false when no workspace stores are cached", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      // Don't access workspace store - cache should be empty
      expect(projectRegistry.hasRunningChats()).toBe(false)
    })
  })

  describe("flushAllChats", () => {
    it("does nothing when no projects exist", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      // Should not throw
      await expect(projectRegistry.flushAllChats()).resolves.toBeUndefined()
    })

    it("does nothing when no workspace stores are cached", async () => {
      vi.resetModules()
      const { projectRegistry } = await import("../ProjectRegistry")
      const { runInAction } = await import("mobx")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_project_registry", undefined)
      })

      runInAction(() => {
        projectRegistry.setProjects([
          {
            id: "repo-1",
            name: "test",
            path: "/test",
            isGitRepo: true,
            workspaces: [
              {
                id: "wt-1",
                projectId: "repo-1",
                branch: "main",
                path: "/test",
                isArchived: false,
                createdAt: new Date(),
              },
            ],
          },
        ])
      })

      // Don't access workspace store - cache should be empty
      // This should complete without error
      await expect(projectRegistry.flushAllChats()).resolves.toBeUndefined()
    })
  })
})
