import { observable, computed, action, makeObservable, runInAction } from "mobx"
import { homeDir } from "@tauri-apps/api/path"
import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs"
import type { Project, Workspace } from "../types"
import { WorkspaceStore, type WorkspaceStatus } from "./WorkspaceStore"
import { getConfigPath } from "../utils/paths"

/**
 * ProjectStore wraps a single Project object with MobX observability and computed properties.
 * This allows for reactive computed values on individual projects.
 */
export class ProjectStore {
  @observable
  id: string

  @observable
  name: string

  @observable
  path: string

  @observable
  isGitRepo: boolean

  @observable
  workspaces: Workspace[]

  @observable
  initPrompt?: string

  @observable
  prPrompt?: string

  @observable
  postCreate?: string

  @observable
  workspaceFilter?: string

  @observable
  useGithub?: boolean

  @observable
  allowMergeToMain?: boolean

  // --- Approval storage (shared across all workspaces in this project) ---

  @observable
  approvedToolNames: Set<string> = new Set()

  @observable
  approvedCommandPrefixes: Set<string> = new Set()

  @observable
  private approvalsLoaded = false

  // WorkspaceStore cache - lazily created
  private _workspaceStoreCache = new Map<string, WorkspaceStore>()

  private home: string | null = null

  constructor(project: Project) {
    this.id = project.id
    this.name = project.name
    this.path = project.path
    this.isGitRepo = project.isGitRepo
    this.workspaces = project.workspaces
    this.initPrompt = project.initPrompt
    this.prPrompt = project.prPrompt
    this.postCreate = project.postCreate
    this.workspaceFilter = project.workspaceFilter
    this.useGithub = project.useGithub
    this.allowMergeToMain = project.allowMergeToMain
    makeObservable(this)
  }

  /**
   * Active workspaces (not archived and not archiving), with optional regex filter applied
   */
  @computed
  get activeWorkspaces(): Workspace[] {
    let filterRegex: RegExp | null = null
    if (this.workspaceFilter) {
      try {
        filterRegex = new RegExp(this.workspaceFilter)
      } catch {
        // Invalid regex - ignore filter
      }
    }

    return this.workspaces
      .filter((wt) => !wt.isArchived && !wt.isArchiving)
      .filter((wt) => !filterRegex || !filterRegex.test(wt.path))
  }

  /**
   * Archived workspaces
   */
  @computed
  get archivedWorkspaces(): Workspace[] {
    return this.workspaces.filter((wt) => wt.isArchived)
  }

  /**
   * Whether this project has any workspaces
   */
  @computed
  get hasWorkspaces(): boolean {
    return this.workspaces.length > 0
  }

  /**
   * Whether this project has any active (non-archived) workspaces
   */
  @computed
  get hasActiveWorkspaces(): boolean {
    return this.activeWorkspaces.length > 0
  }

  /**
   * Find a workspace by its ID
   */
  getWorkspaceById(id: string): Workspace | undefined {
    return this.workspaces.find((wt) => wt.id === id)
  }

  /**
   * Find a workspace by its path
   */
  getWorkspaceByPath(path: string): Workspace | undefined {
    return this.workspaces.find((wt) => wt.path === path)
  }

  /**
   * Find a workspace by its branch name
   */
  getWorkspaceByBranch(branch: string): Workspace | undefined {
    return this.workspaces.find((wt) => wt.branch === branch)
  }

  /**
   * Get or create a WorkspaceStore for a workspace.
   * Returns undefined if the workspace doesn't exist.
   */
  getWorkspaceStore(workspaceId: string): WorkspaceStore | undefined {
    const workspace = this.getWorkspaceById(workspaceId)
    if (!workspace) return undefined
    return this.getOrCreateWorkspaceStore(workspace)
  }

  /**
   * Get or create a WorkspaceStore for a workspace.
   * If the workspace is still being created (empty path), returns a non-cached store.
   */
  getOrCreateWorkspaceStore(workspace: Workspace): WorkspaceStore {
    // If workspace is still being created, don't cache the store
    // because the path will be updated once the git worktree is ready
    if (!workspace.path) {
      return new WorkspaceStore(workspace, this.name, this.initPrompt)
    }

    let store = this._workspaceStoreCache.get(workspace.id)
    if (!store) {
      store = new WorkspaceStore(workspace, this.name, this.initPrompt)
      this._workspaceStoreCache.set(workspace.id, store)
    }
    return store
  }

  /**
   * Get the status of a workspace (idle, running, needs_attention, done)
   */
  getWorkspaceStatus(workspaceId: string): WorkspaceStatus {
    const store = this._workspaceStoreCache.get(workspaceId)
    return store?.status ?? "idle"
  }

  /**
   * Get all cached WorkspaceStores (for flushing chats on window close)
   */
  get workspaceStores(): WorkspaceStore[] {
    return Array.from(this._workspaceStoreCache.values())
  }

  /**
   * Clean up WorkspaceStore cache for removed workspaces
   */
  cleanupWorkspaceCache(): void {
    const validIds = new Set(this.workspaces.map((w) => w.id))
    for (const id of this._workspaceStoreCache.keys()) {
      if (!validIds.has(id)) {
        this._workspaceStoreCache.get(id)?.dispose()
        this._workspaceStoreCache.delete(id)
      }
    }
  }

  /**
   * Update project settings
   */
  @action
  update(updates: {
    initPrompt?: string
    prPrompt?: string
    postCreate?: string
    workspaceFilter?: string
    useGithub?: boolean
    allowMergeToMain?: boolean
  }): void {
    if (updates.initPrompt !== undefined) this.initPrompt = updates.initPrompt || undefined
    if (updates.prPrompt !== undefined) this.prPrompt = updates.prPrompt || undefined
    if (updates.postCreate !== undefined) this.postCreate = updates.postCreate || undefined
    if (updates.workspaceFilter !== undefined)
      this.workspaceFilter = updates.workspaceFilter || undefined
    if (updates.useGithub !== undefined) this.useGithub = updates.useGithub
    if (updates.allowMergeToMain !== undefined) this.allowMergeToMain = updates.allowMergeToMain
  }

  // --- Approval persistence ---

  private async resolveHome(): Promise<string> {
    if (!this.home) {
      this.home = await homeDir()
      if (this.home.endsWith("/")) {
        this.home = this.home.slice(0, -1)
      }
    }
    return this.home
  }

  private async getProjectChatsDir(): Promise<string> {
    const home = await this.resolveHome()
    return `${getConfigPath(home)}/chats/${this.name}`
  }

  /**
   * Load approvals from project-level storage.
   * Called by WorkspaceStore when loading a workspace.
   */
  async loadApprovals(): Promise<void> {
    if (this.approvalsLoaded) return

    try {
      const projectDir = await this.getProjectChatsDir()
      const approvalsPath = `${projectDir}/approvals.json`

      const fileExists = await exists(approvalsPath)
      if (!fileExists) {
        runInAction(() => {
          this.approvalsLoaded = true
        })
        return
      }

      const raw = await readTextFile(approvalsPath)
      const data = JSON.parse(raw) as {
        toolNames?: string[]
        commandPrefixes?: string[]
      }

      runInAction(() => {
        if (Array.isArray(data.toolNames)) {
          this.approvedToolNames = new Set(data.toolNames)
        }
        if (Array.isArray(data.commandPrefixes)) {
          this.approvedCommandPrefixes = new Set(data.commandPrefixes)
        }
        this.approvalsLoaded = true
      })
    } catch (err) {
      console.error("Failed to load approvals from disk:", err)
      runInAction(() => {
        this.approvalsLoaded = true
      })
    }
  }

  /**
   * Save approvals to project-level storage.
   */
  async saveApprovals(): Promise<void> {
    try {
      const projectDir = await this.getProjectChatsDir()

      // Ensure directory exists
      const dirExists = await exists(projectDir)
      if (!dirExists) {
        await mkdir(projectDir, { recursive: true })
      }

      const data = {
        toolNames: Array.from(this.approvedToolNames),
        commandPrefixes: Array.from(this.approvedCommandPrefixes),
      }
      await writeTextFile(`${projectDir}/approvals.json`, JSON.stringify(data, null, 2) + "\n")
    } catch (err) {
      console.error("Failed to save approvals to disk:", err)
    }
  }

  /**
   * Remove a tool from the approved list
   */
  @action
  removeToolApproval(tool: string): void {
    this.approvedToolNames.delete(tool)
    void this.saveApprovals()
  }

  /**
   * Remove a command prefix from the approved list
   */
  @action
  removeCommandApproval(command: string): void {
    this.approvedCommandPrefixes.delete(command)
    void this.saveApprovals()
  }

  /**
   * Clear all approvals (both tools and commands)
   */
  @action
  clearAllApprovals(): void {
    this.approvedToolNames.clear()
    this.approvedCommandPrefixes.clear()
    void this.saveApprovals()
  }

  /**
   * Convert back to plain Project object for serialization
   */
  toProject(): Project {
    return {
      id: this.id,
      name: this.name,
      path: this.path,
      isGitRepo: this.isGitRepo,
      workspaces: this.workspaces,
      initPrompt: this.initPrompt,
      prPrompt: this.prPrompt,
      postCreate: this.postCreate,
      workspaceFilter: this.workspaceFilter,
      useGithub: this.useGithub,
      allowMergeToMain: this.allowMergeToMain,
    }
  }
}
