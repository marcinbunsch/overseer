import { observable, action, computed, makeObservable, runInAction } from "mobx"
import { backend, type Unsubscribe } from "../backend"
import { gitService, type PrStatus } from "../services/git"
import { projectRegistry } from "./ProjectRegistry"
import { toastStore } from "./ToastStore"
import { eventBus } from "../utils/eventBus"
import type { ChangedFile } from "../types"

/**
 * Store for managing changed files pane state.
 * Each pane instance should create its own store.
 */
export class ChangedFilesStore {
  /** Committed changes on this branch vs main */
  @observable files: ChangedFile[] = []
  /** Uncommitted changes (staged + unstaged vs HEAD) */
  @observable uncommitted: ChangedFile[] = []
  @observable isDefaultBranch = false
  @observable loading = false
  @observable error: string | null = null
  @observable checking = false
  @observable merging = false
  @observable showMergeConfirm = false
  @observable diffFile: ChangedFile | null = null
  @observable prStatus: PrStatus | null = null
  @observable prLoading = false

  private workspacePath: string
  private workspaceId: string
  private unlisteners: Unsubscribe[] = []
  private eventBusUnsubscribers: (() => void)[] = []
  private prevRunningCount = 0
  private disposed = false
  private isActive = false
  private lastLoadTime = 0

  // How long to consider data "fresh" and skip refresh (in ms)
  private static readonly STALE_THRESHOLD = 5000 // 5 seconds

  constructor(workspacePath: string, workspaceId: string) {
    makeObservable(this)
    this.workspacePath = workspacePath
    this.workspaceId = workspaceId

    // Initialize PR status from stored workspace data
    const wt = projectRegistry.selectedWorkspace
    if (wt?.prNumber && wt.prUrl && wt.prState) {
      this.prStatus = { number: wt.prNumber, url: wt.prUrl, state: wt.prState, is_draft: false }
    }
  }

  @action
  async refresh(): Promise<void> {
    this.loading = true
    this.error = null

    try {
      const result = await gitService.listChangedFiles(this.workspacePath)
      runInAction(() => {
        // Mark uncommitted files with the flag
        this.uncommitted = result.uncommitted.map((f) => ({ ...f, isUncommitted: true }))
        this.files = result.files
        this.isDefaultBranch = result.is_default_branch
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
    this.refreshPr() // Refresh PR status after loading files (to update merged/closed status)
  }

  /**
   * Check if the data is stale (hasn't been loaded or loaded too long ago)
   */
  private isDataStale(): boolean {
    if (this.lastLoadTime === 0) return true
    return Date.now() - this.lastLoadTime > ChangedFilesStore.STALE_THRESHOLD
  }

  refreshPrTimeout: number | null = null
  async refreshPr(): Promise<void> {
    // If a refresh is already scheduled, skip to avoid multiple rapid calls
    if (this.refreshPrTimeout) clearTimeout(this.refreshPrTimeout)

    // Schedule a refresh after a short delay to batch multiple rapid calls (e.g. after chat finishes and files refresh)
    this.refreshPrTimeout = window.setTimeout(() => {
      this.refreshPrTimeout = null
      this.refreshPrCall()
    }, 1000)
  }

  @action
  async refreshPrCall(): Promise<void> {
    // Skip if already refreshing to avoid concurrent gh CLI calls
    if (this.prLoading) return

    // Find this store's workspace to get the branch name
    const workspace = projectRegistry.selectedProject?.workspaces?.find(
      (w) => w.id === this.workspaceId
    )
    if (!workspace) return

    this.prLoading = true
    try {
      const status = await gitService.getPrStatus(this.workspacePath, workspace.branch)
      // Ignore result if store was disposed while waiting
      if (this.disposed) return
      runInAction(() => {
        this.prStatus = status
        projectRegistry.updateWorkspacePr(
          this.workspaceId,
          status ? { number: status.number, url: status.url, state: status.state } : null
        )
      })
    } catch {
      if (this.disposed) return
      runInAction(() => {
        this.prStatus = null
      })
    } finally {
      if (!this.disposed) {
        runInAction(() => {
          this.prLoading = false
        })
      }
    }
  }

  @action
  async checkMerge(): Promise<void> {
    this.checking = true
    this.error = null

    try {
      const result = await gitService.checkMerge(this.workspacePath)
      runInAction(() => {
        if (result.success) {
          this.showMergeConfirm = true
        } else if (result.conflicts.length > 0) {
          const uniqueList = Array.from(new Set(result.conflicts)).join(", ")
          const workspaceStore = projectRegistry.selectedWorkspaceStore
          workspaceStore?.sendMessage(
            `There are merge conflicts in the following files that need resolution: ${uniqueList}. Please merge in the local default branch and resolve these merge conflicts.`
          )
          this.refresh()
        } else {
          this.error = result.message
        }
      })
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : String(err)
      })
    } finally {
      runInAction(() => {
        this.checking = false
      })
    }
  }

  @action
  async merge(archiveAfter: boolean, deleteBranch: boolean): Promise<void> {
    this.showMergeConfirm = false
    this.merging = true

    // Capture branch name and project path before archiving (workspace will be gone after archive)
    const wt = projectRegistry.selectedWorkspace
    const project = projectRegistry.selectedProject
    const branchName = wt?.branch
    const projectPath = project?.path

    try {
      const result = await gitService.mergeIntoMain(this.workspacePath)
      if (result.success) {
        let toastMessage = "Branch merged successfully"

        if (archiveAfter) {
          await projectRegistry.archiveWorkspace(this.workspaceId)
          toastMessage = "Branch merged and workspace archived"

          // Delete branch after successful archive
          if (deleteBranch && branchName && projectPath) {
            try {
              await gitService.deleteBranch(projectPath, branchName)
              toastMessage = "Branch merged, workspace archived, and branch deleted"
            } catch {
              // Branch deletion failed but merge and archive succeeded
              // Don't fail the whole operation
            }
          }
        }

        // Switch to main workspace after successful merge
        if (project) {
          projectRegistry.switchToMainWorkspace(project.id)
        }

        toastStore.show(toastMessage)
        await this.refresh()
        // Refresh PR state to show merged status (skip if archiving since workspace goes away)
        if (!archiveAfter) {
          await this.refreshPr()
        }
      } else if (result.conflicts.length > 0) {
        const uniqueList = Array.from(new Set(result.conflicts)).join(", ")
        const workspaceStore = projectRegistry.selectedWorkspaceStore
        workspaceStore?.sendMessage(
          `There are merge conflicts in the following files that need resolution: ${uniqueList}. Please merge in the local default branch and resolve these merge conflicts.`
        )
        this.refresh()
      } else {
        runInAction(() => {
          this.error = result.message
        })
      }
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : String(err)
      })
    } finally {
      runInAction(() => {
        this.merging = false
      })
    }
  }

  @action
  createPR(): void {
    const wt = projectRegistry.selectedWorkspace
    if (!wt) return

    let prompt = `Please look at the changes on branch "${wt.branch}" and create a GitHub pull request. Summarize the changes and use \`gh pr create\` to create the PR with a descriptive title and body based on the actual code changes.`

    const project = projectRegistry.selectedProject
    if (project?.prPrompt) {
      prompt += `\n\nAdditional instructions: ${project.prPrompt}`
    }

    const workspaceStore = projectRegistry.selectedWorkspaceStore
    workspaceStore?.sendMessage(prompt, {
      type: "create-pr",
      label: "Create PR",
    })
  }

  @action
  setDiffFile(file: ChangedFile | null): void {
    this.diffFile = file
  }

  /**
   * Open the diff review dialog with the first available file.
   * Prefers uncommitted changes, falls back to branch changes.
   */
  @action
  openReview(): void {
    const firstFile = this.uncommitted[0] ?? this.files[0]
    if (firstFile) {
      this.diffFile = firstFile
    }
  }

  @action
  setShowMergeConfirm(show: boolean): void {
    this.showMergeConfirm = show
  }

  /** Total count of all changed files (uncommitted + branch changes) */
  @computed
  get totalFileCount(): number {
    return this.uncommitted.length + this.files.length
  }

  /** All files combined for DiffDialog navigation */
  @computed
  get allFiles(): ChangedFile[] {
    return [...this.uncommitted, ...this.files]
  }

  /**
   * Activate event listeners for auto-refresh.
   * Can be called multiple times safely - will only set up listeners once,
   * and will only refresh data if it's stale.
   */
  activate(): void {
    // Only refresh if data is stale (not loaded yet, or loaded >5 seconds ago)
    // This makes workspace switching much faster on subsequent visits
    if (this.isDataStale()) {
      // Initial load - refresh files, but use cached PR status
      // PR status is already initialized from stored workspace data in constructor
      // We skip refreshPr() here to avoid the slow gh CLI call (~200ms) on workspace switch
      // PR status will be refreshed when chats finish (via setupChatListeners)
      this.refresh()
    }

    // Only set up listeners if not already active
    if (this.isActive) return
    this.isActive = true

    // Subscribe to chat close events
    this.setupChatListeners()

    // Subscribe to overseer action events
    this.setupOverseerActionListeners()

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
    for (const unsubscribe of this.eventBusUnsubscribers) {
      unsubscribe()
    }
    this.eventBusUnsubscribers = []
  }

  /**
   * Fully dispose the store (cleanup for WorkspaceStore disposal)
   */
  dispose(): void {
    this.deactivate()
    this.disposed = true
  }

  private setupChatListeners(): void {
    const workspaceStore = projectRegistry.selectedWorkspaceStore
    const chats = workspaceStore?.activeChats ?? []
    for (const { chat } of chats) {
      backend
        .listen<unknown>(`claude:close:${chat.id}`, () => {
          setTimeout(() => {
            this.refresh()
            this.refreshPr()
          }, 500)
        })
        .then((unlisten) => {
          this.unlisteners.push(unlisten)
        })
    }
  }

  private setupOverseerActionListeners(): void {
    // Listen for open_pr action - trigger createPR flow
    this.eventBusUnsubscribers.push(
      eventBus.on("overseer:open_pr", () => {
        this.createPR()
      })
    )

    // Listen for merge_branch action - trigger checkMerge flow
    this.eventBusUnsubscribers.push(
      eventBus.on("overseer:merge_branch", () => {
        this.checkMerge()
      })
    )
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
        this.refreshPr()
      }, 500)
    }
    this.prevRunningCount = runningCount
  }
}
