import { observable, computed, action, makeObservable, runInAction } from "mobx"
import type { Project, Workspace } from "../types"
import { gitService } from "../services/git"
import { terminalService } from "../services/terminal"
import { ProjectStore } from "./ProjectStore"
import type { WorkspaceStore, WorkspaceStatus } from "./WorkspaceStore"
import { toastStore } from "./ToastStore"
import { workspaceHistoryStore } from "./WorkspaceHistoryStore"
import { backend } from "../backend"

class ProjectRegistry {
  @observable private _projects: Project[] = []
  private _projectStoreCache = new Map<string, ProjectStore>()
  @observable selectedProjectId: string | null = null
  @observable selectedWorkspaceId: string | null = null

  constructor() {
    makeObservable(this)
    this.loadFromFile()
  }

  /**
   * Returns ProjectStore instances for all projects.
   * Caches ProjectStore instances to maintain referential stability.
   */
  @computed get projects(): ProjectStore[] {
    // Clean up cache for removed projects
    const currentIds = new Set(this._projects.map((r) => r.id))
    for (const id of this._projectStoreCache.keys()) {
      if (!currentIds.has(id)) {
        this._projectStoreCache.delete(id)
      }
    }

    // Return ProjectStore instances, creating new ones as needed
    return this._projects.map((project) => {
      let store = this._projectStoreCache.get(project.id)
      if (!store) {
        store = new ProjectStore(project)
        this._projectStoreCache.set(project.id, store)
      }
      return store
    })
  }

  @computed get selectedProject(): ProjectStore | undefined {
    return this.projects.find((r) => r.id === this.selectedProjectId)
  }

  @computed get selectedWorkspace(): Workspace | undefined {
    if (!this.selectedProject || !this.selectedWorkspaceId) return undefined
    return this.selectedProject.workspaces.find((w) => w.id === this.selectedWorkspaceId)
  }

  /**
   * Get the WorkspaceStore for the currently selected workspace.
   * Returns undefined if no workspace is selected.
   */
  @computed get selectedWorkspaceStore(): WorkspaceStore | undefined {
    if (!this.selectedProject || !this.selectedWorkspaceId) return undefined
    return this.selectedProject.getWorkspaceStore(this.selectedWorkspaceId)
  }

  /**
   * Get a ProjectStore by ID.
   * Returns undefined if the project doesn't exist.
   */
  getProjectStore(projectId: string): ProjectStore | undefined {
    // Trigger computed to ensure cache is populated
    return this.projects.find((p) => p.id === projectId)
  }

  /**
   * Get the status of a workspace (idle, running, needs_attention, done)
   */
  getWorkspaceStatus(workspaceId: string): WorkspaceStatus {
    for (const project of this.projects) {
      const status = project.getWorkspaceStatus(workspaceId)
      if (status !== "idle" || project.getWorkspaceById(workspaceId)) {
        return status
      }
    }
    return "idle"
  }

  @action async addProject(path: string): Promise<void> {
    const name = path.split("/").pop() || path
    const id = crypto.randomUUID()

    const isGitRepo = await gitService.isGitRepo(path)
    const gitWorkspaces = isGitRepo ? await gitService.listWorkspaces(path) : []

    // For non-git projects, create a single workspace with the project name
    const workspaces = isGitRepo
      ? gitWorkspaces.map((wt) => ({
          id: crypto.randomUUID(),
          projectId: id,
          branch: wt.branch,
          path: wt.path,
          isArchived: false,
          createdAt: new Date(),
        }))
      : [
          {
            id: crypto.randomUUID(),
            projectId: id,
            branch: name,
            path,
            isArchived: false,
            createdAt: new Date(),
          },
        ]

    runInAction(() => {
      this._projects.push({
        id,
        name,
        path,
        isGitRepo,
        workspaces,
      })
    })
    await this.saveToFile()
  }

  @action updateProject(
    id: string,
    updates: {
      initPrompt?: string
      prPrompt?: string
      postCreate?: string
      workspaceFilter?: string
      useGithub?: boolean
      allowMergeToMain?: boolean
    }
  ): void {
    const project = this._projects.find((r) => r.id === id)
    if (!project) return
    if (updates.initPrompt !== undefined) project.initPrompt = updates.initPrompt || undefined
    if (updates.prPrompt !== undefined) project.prPrompt = updates.prPrompt || undefined
    if (updates.postCreate !== undefined) project.postCreate = updates.postCreate || undefined
    if (updates.workspaceFilter !== undefined)
      project.workspaceFilter = updates.workspaceFilter || undefined
    if (updates.useGithub !== undefined) project.useGithub = updates.useGithub
    if (updates.allowMergeToMain !== undefined) project.allowMergeToMain = updates.allowMergeToMain
    // Also update the cached ProjectStore if it exists
    const store = this._projectStoreCache.get(id)
    if (store) {
      store.update(updates)
    }
    this.saveToFile()
  }

  @action removeProject(id: string): void {
    this._projects = this._projects.filter((r) => r.id !== id)
    this._projectStoreCache.delete(id)
    if (this.selectedProjectId === id) {
      this.selectedProjectId = null
      this.selectedWorkspaceId = null
    }
    this.saveToFile()
  }

  /**
   * Set projects directly (for testing purposes).
   * Clears the ProjectStore cache to ensure fresh instances.
   */
  @action setProjects(projects: Project[]): void {
    this._projects = projects
    this._projectStoreCache.clear()
  }

  @action selectProject(id: string): void {
    this.selectedProjectId = id
    this.selectedWorkspaceId = null
  }

  @action selectWorkspace(id: string, addToHistory = true): void {
    this.selectedWorkspaceId = id
    if (addToHistory) {
      workspaceHistoryStore.push(id)
    }
  }

  @action switchToMainWorkspace(projectId: string): void {
    const project = this._projects.find((r) => r.id === projectId)
    if (!project) return
    const mainWorkspace = project.workspaces.find(
      (w) => !w.isArchived && !w.isArchiving && (w.branch === "main" || w.branch === "master")
    )
    if (mainWorkspace) {
      this.selectedProjectId = projectId
      this.selectedWorkspaceId = mainWorkspace.id
    }
  }

  @action addWorkspace(projectId: string, branch: string): void {
    const project = this._projects.find((r) => r.id === projectId)
    if (!project) return

    const postCreate = project.postCreate
    const id = crypto.randomUUID()

    // Add workspace immediately with isCreating state
    project.workspaces.push({
      id,
      projectId,
      branch,
      path: "", // Will be set when git worktree is ready
      isArchived: false,
      isCreating: true,
      createdAt: new Date(),
    })

    // Update cached ProjectStore
    const projectStore = this._projectStoreCache.get(projectId)
    if (projectStore) {
      projectStore.workspaces = project.workspaces
    }

    // Select the new workspace immediately
    this.selectedProjectId = projectId
    this.selectedWorkspaceId = id

    // Create git worktree in background
    gitService
      .addWorkspace(project.path, branch)
      .then((workspacePath) => {
        runInAction(() => {
          const wt = project.workspaces.find((w) => w.id === id)
          if (wt) {
            wt.path = workspacePath
            wt.isCreating = false
          }
          if (projectStore) {
            projectStore.workspaces = project.workspaces
          }
        })
        this.saveToFile()

        // Run postCreate script after terminal is ready
        if (postCreate) {
          terminalService.getOrCreate(workspacePath, project.path).then(async () => {
            await terminalService.waitForReady(workspacePath)
            terminalService.write(workspacePath, postCreate + "\n")
          })
        }
      })
      .catch((err) => {
        console.error("Failed to create workspace:", err)
        // Remove the failed workspace
        runInAction(() => {
          const idx = project.workspaces.findIndex((w) => w.id === id)
          if (idx >= 0) {
            project.workspaces.splice(idx, 1)
          }
          if (projectStore) {
            projectStore.workspaces = project.workspaces
          }
          // Switch back to previous workspace or null
          if (this.selectedWorkspaceId === id) {
            const active = project.workspaces.find((w) => !w.isArchived && !w.isCreating)
            this.selectedWorkspaceId = active?.id ?? null
          }
        })
        toastStore.show(`Failed to create workspace: ${err}`)
      })
  }

  @action async archiveWorkspace(workspaceId: string, deleteBranch = false): Promise<void> {
    for (const project of this._projects) {
      const wt = project.workspaces.find((w) => w.id === workspaceId)
      if (wt) {
        // Capture branch name before archiving
        const branchName = wt.branch
        const projectPath = project.path

        // Get WorkspaceStore to archive its chat folder
        const projectStore = this._projectStoreCache.get(project.id)
        const workspaceStore = projectStore?.getWorkspaceStore(workspaceId)

        // Optimistic update: mark as archiving and switch focus immediately
        wt.isArchiving = true
        // Also update the cached ProjectStore if it exists
        if (projectStore) {
          projectStore.workspaces = project.workspaces
        }
        if (this.selectedWorkspaceId === workspaceId) {
          this.switchToMainWorkspace(project.id)
        }

        try {
          try {
            await gitService.archiveWorkspace(project.path, wt.path)
          } catch (err) {
            console.warn("Failed to remove workspace from git, cleaning up anyway:", err)
          }
          terminalService.destroy(wt.path)

          // Archive the chat folder using WorkspaceStore
          if (workspaceStore) {
            await workspaceStore.archiveChatFolder()
          }

          // Delete branch after successful archive if requested
          if (deleteBranch) {
            try {
              await gitService.deleteBranch(projectPath, branchName)
            } catch {
              // Branch deletion failed but archive succeeded - don't fail the operation
            }
          }

          runInAction(() => {
            wt.isArchiving = false
            wt.isArchived = true
            if (projectStore) {
              projectStore.workspaces = project.workspaces
              projectStore.cleanupWorkspaceCache()
            }
            workspaceHistoryStore.remove(workspaceId)
            this.saveToFile()
          })
        } catch (err) {
          // Revert optimistic update on failure
          runInAction(() => {
            wt.isArchiving = false
            if (projectStore) {
              projectStore.workspaces = project.workspaces
            }
          })
          throw err
        }
        break
      }
    }
  }

  @action async renameBranch(workspaceId: string, newName: string): Promise<void> {
    for (const project of this._projects) {
      const wt = project.workspaces.find((w) => w.id === workspaceId)
      if (wt) {
        await gitService.renameBranch(wt.path, newName)
        runInAction(() => {
          wt.branch = newName
          // Also update the cached ProjectStore if it exists
          const store = this._projectStoreCache.get(project.id)
          if (store) {
            store.workspaces = project.workspaces
          }
          this.saveToFile()
        })
        break
      }
    }
  }

  /**
   * Rename a branch with validation and error handling.
   * Returns true if rename succeeded, false otherwise.
   */
  async renameBranchSafe(
    workspaceId: string,
    newName: string,
    currentBranch: string
  ): Promise<boolean> {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === currentBranch) return false
    try {
      await this.renameBranch(workspaceId, trimmed)
      return true
    } catch (err) {
      console.error("Failed to rename branch:", err)
      return false
    }
  }

  @action updateWorkspacePr(
    workspaceId: string,
    pr: { number: number; url: string; state: "OPEN" | "MERGED" | "CLOSED" } | null
  ): void {
    for (const project of this._projects) {
      const wt = project.workspaces.find((w) => w.id === workspaceId)
      if (wt) {
        // Check if anything actually changed
        const changed = pr
          ? wt.prNumber !== pr.number || wt.prUrl !== pr.url || wt.prState !== pr.state
          : wt.prNumber !== undefined || wt.prUrl !== undefined || wt.prState !== undefined

        if (!changed) return

        if (pr) {
          wt.prNumber = pr.number
          wt.prUrl = pr.url
          wt.prState = pr.state
        } else {
          wt.prNumber = undefined
          wt.prUrl = undefined
          wt.prState = undefined
        }
        // Also update the cached ProjectStore if it exists
        const store = this._projectStoreCache.get(project.id)
        if (store) {
          store.workspaces = project.workspaces
        }
        this.saveToFile()
        break
      }
    }
  }

  @action selectPreviousWorkspace(): void {
    // Use ProjectStore.activeWorkspaces to apply the same filtering as display (including workspaceFilter)
    const all = this.projects.flatMap((r) =>
      r.activeWorkspaces.map((w) => ({ projectId: r.id, workspaceId: w.id }))
    )
    if (all.length === 0) return
    const idx = all.findIndex((e) => e.workspaceId === this.selectedWorkspaceId)
    const prev = idx <= 0 ? all[all.length - 1] : all[idx - 1]
    this.selectedProjectId = prev.projectId
    this.selectWorkspace(prev.workspaceId)
  }

  @action selectNextWorkspace(): void {
    // Use ProjectStore.activeWorkspaces to apply the same filtering as display (including workspaceFilter)
    const all = this.projects.flatMap((r) =>
      r.activeWorkspaces.map((w) => ({ projectId: r.id, workspaceId: w.id }))
    )
    if (all.length === 0) return
    const idx = all.findIndex((e) => e.workspaceId === this.selectedWorkspaceId)
    const next = idx < 0 || idx >= all.length - 1 ? all[0] : all[idx + 1]
    this.selectedProjectId = next.projectId
    this.selectWorkspace(next.workspaceId)
  }

  /**
   * Navigate back in workspace history (Cmd+[).
   */
  @action goBackInHistory(): void {
    const workspaceId = workspaceHistoryStore.goBack()
    if (!workspaceId) return

    // Find the project for this workspace
    for (const project of this.projects) {
      const workspace = project.workspaces.find((w) => w.id === workspaceId)
      if (workspace && !workspace.isArchived && !workspace.isArchiving) {
        this.selectedProjectId = project.id
        this.selectWorkspace(workspaceId, false) // Don't add to history
        return
      }
    }
    // Workspace not found or archived, try going back again
    this.goBackInHistory()
  }

  /**
   * Navigate forward in workspace history (Cmd+]).
   */
  @action goForwardInHistory(): void {
    const workspaceId = workspaceHistoryStore.goForward()
    if (!workspaceId) return

    // Find the project for this workspace
    for (const project of this.projects) {
      const workspace = project.workspaces.find((w) => w.id === workspaceId)
      if (workspace && !workspace.isArchived && !workspace.isArchiving) {
        this.selectedProjectId = project.id
        this.selectWorkspace(workspaceId, false) // Don't add to history
        return
      }
    }
    // Workspace not found or archived, try going forward again
    this.goForwardInHistory()
  }

  @action async refreshWorkspaces(projectId: string): Promise<void> {
    const project = this._projects.find((r) => r.id === projectId)
    if (!project) return

    const workspaces = await gitService.listWorkspaces(project.path)

    runInAction(() => {
      project.workspaces = workspaces.map((wt) => {
        const existing = project.workspaces.find((ew) => ew.path === wt.path)
        return {
          id: existing?.id || crypto.randomUUID(),
          projectId,
          branch: wt.branch,
          path: wt.path,
          isArchived: existing?.isArchived || false,
          createdAt: existing?.createdAt || new Date(),
        }
      })
      // Also update the cached ProjectStore if it exists
      const store = this._projectStoreCache.get(projectId)
      if (store) {
        store.workspaces = project.workspaces
        store.cleanupWorkspaceCache()
      }
      this.saveToFile()
    })
  }

  private async saveToFile(): Promise<void> {
    try {
      // Rust handles backward compatibility (writes to both projects.json and repos.json)
      await backend.invoke("save_project_registry", {
        registry: { projects: this._projects },
      })
    } catch (err) {
      console.error("Failed to save projects:", err)
    }
  }

  /**
   * Check if any chats are currently running (sending messages).
   */
  hasRunningChats(): boolean {
    for (const projectStore of this._projectStoreCache.values()) {
      for (const workspaceStore of projectStore.workspaceStores) {
        for (const chatStore of workspaceStore.allChats) {
          if (chatStore.chat.status === "running") {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * Flush all pending chat saves to disk immediately.
   * Called before window close to ensure no data is lost.
   */
  async flushAllChats(): Promise<void> {
    // Chat persistence now flushes events immediately in Rust.
    return
  }

  private async loadFromFile(): Promise<void> {
    try {
      // Rust handles all migration logic (worktrees→workspaces, repoId→projectId, etc.)
      const registry = await backend.invoke<{ projects: Project[] }>("load_project_registry")
      runInAction(() => {
        this._projects = registry.projects
      })
    } catch (err) {
      console.error("Failed to load projects:", err)
    }
  }
}

export const projectRegistry = new ProjectRegistry()
