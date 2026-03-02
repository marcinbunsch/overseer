import { observable, action, makeObservable, runInAction } from "mobx"
import { backend, type Unsubscribe } from "../backend"
import { GitService } from "../services/git"
import { projectRegistry } from "./ProjectRegistry"
import type { Commit } from "../types"

/**
 * Store for managing commits pane state.
 * Each workspace creates its own store (cached in WorkspaceStore).
 */
export class CommitsStore {
  /** Commits on this branch vs main */
  @observable commits: Commit[] = []
  @observable loading = false
  @observable error: string | null = null
  /** Commit being viewed in CommitDiffDialog */
  @observable diffCommit: Commit | null = null

  private workspacePath: string
  private gitService: GitService
  private unlisteners: Unsubscribe[] = []
  private prevRunningCount = 0
  private isActive = false
  private lastLoadTime = 0

  // How long to consider data "fresh" and skip refresh (in ms)
  private static readonly STALE_THRESHOLD = 5000 // 5 seconds

  constructor(workspacePath: string, gitService: GitService) {
    makeObservable(this)
    this.workspacePath = workspacePath
    this.gitService = gitService
  }

  @action
  async refresh(): Promise<void> {
    this.loading = true
    this.error = null

    try {
      const result = await this.gitService.listCommits(this.workspacePath)
      runInAction(() => {
        this.commits = result
        this.lastLoadTime = Date.now()
      })
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : String(err)
      })
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  /**
   * Check if the data is stale (hasn't been loaded or loaded too long ago)
   */
  private isDataStale(): boolean {
    if (this.lastLoadTime === 0) return true
    return Date.now() - this.lastLoadTime > CommitsStore.STALE_THRESHOLD
  }

  @action
  setDiffCommit(commit: Commit | null): void {
    this.diffCommit = commit
  }

  /**
   * Activate event listeners for auto-refresh.
   * Can be called multiple times safely - will only set up listeners once,
   * and will only refresh data if it's stale.
   */
  activate(): void {
    // Only refresh if data is stale
    if (this.isDataStale()) {
      this.refresh()
    }

    // Only set up listeners if not already active
    if (this.isActive) return
    this.isActive = true

    // Subscribe to chat close events
    this.setupChatListeners()

    // Track running count for auto-refresh when chats finish
    const workspaceStore = projectRegistry.selectedWorkspaceStore
    this.prevRunningCount =
      workspaceStore?.activeChats.filter((cs) => cs.chat.status === "running").length ?? 0
  }

  /**
   * Deactivate event listeners when switching away from workspace.
   * Data is preserved so it doesn't need to be reloaded on return.
   */
  deactivate(): void {
    this.isActive = false
    for (const unlisten of this.unlisteners) {
      unlisten()
    }
    this.unlisteners = []
  }

  /**
   * Fully dispose the store (cleanup for WorkspaceStore disposal)
   */
  dispose(): void {
    this.deactivate()
  }

  private setupChatListeners(): void {
    const workspaceStore = projectRegistry.selectedWorkspaceStore
    const chats = workspaceStore?.activeChats ?? []
    for (const { chat } of chats) {
      backend
        .listen<unknown>(`claude:close:${chat.id}`, () => {
          setTimeout(() => {
            this.refresh()
          }, 500)
        })
        .then((unlisten) => {
          this.unlisteners.push(unlisten)
        })
    }
  }

  /**
   * Check if running count changed and trigger refresh if needed.
   * Call this from component's useEffect when runningCount changes.
   */
  @action
  onRunningCountChange(runningCount: number): void {
    if (runningCount === 0 && this.prevRunningCount > 0) {
      // A chat finished, refresh after delay
      setTimeout(() => {
        this.refresh()
      }, 500)
    }
    this.prevRunningCount = runningCount
  }
}
