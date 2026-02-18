import { observable, action, makeObservable, runInAction } from "mobx"
import { backend } from "../backend"

/**
 * Tracks workspace navigation history for back/forward navigation.
 * History is stored in ~/.config/overseer[-dev]/history.json
 */
class WorkspaceHistoryStore {
  /**
   * Stack of workspace IDs, most recently visited at the end.
   * The current position is always at historyIndex.
   */
  @observable
  private history: string[] = []

  /**
   * Current position in history. When navigating back, this decreases.
   * When navigating forward, this increases.
   * When selecting a new workspace, all entries after this position are removed.
   */
  @observable
  private historyIndex = -1

  private loaded = false
  private saveTimeout: ReturnType<typeof setTimeout> | null = null

  constructor() {
    makeObservable(this)
    this.load()
  }

  /**
   * Record a workspace selection. This adds it to history.
   * If the workspace already exists in history, it's moved to the current position.
   * If we're in the middle of history (navigated back), this clears forward history.
   */
  @action
  push(workspaceId: string): void {
    // Don't push duplicates at current position
    if (this.history[this.historyIndex] === workspaceId) {
      return
    }

    // If we're in the middle of history, truncate forward entries
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1)
    }

    // Remove any existing occurrence of this workspace from history
    const existingIndex = this.history.indexOf(workspaceId)
    if (existingIndex !== -1) {
      this.history.splice(existingIndex, 1)
    }

    // Add new entry and update index
    this.history.push(workspaceId)
    this.historyIndex = this.history.length - 1

    // Limit history size to prevent unbounded growth
    const maxHistory = 100
    if (this.history.length > maxHistory) {
      const trimCount = this.history.length - maxHistory
      this.history = this.history.slice(trimCount)
      this.historyIndex = Math.max(0, this.historyIndex - trimCount)
    }

    this.scheduleSave()
  }

  /**
   * Navigate back in history. Returns the workspace ID to select, or null if can't go back.
   */
  @action
  goBack(): string | null {
    if (this.historyIndex <= 0) {
      return null
    }
    this.historyIndex--
    this.scheduleSave()
    return this.history[this.historyIndex]
  }

  /**
   * Navigate forward in history. Returns the workspace ID to select, or null if can't go forward.
   */
  @action
  goForward(): string | null {
    if (this.historyIndex >= this.history.length - 1) {
      return null
    }
    this.historyIndex++
    this.scheduleSave()
    return this.history[this.historyIndex]
  }

  /**
   * Check if we can go back in history.
   */
  get canGoBack(): boolean {
    return this.historyIndex > 0
  }

  /**
   * Check if we can go forward in history.
   */
  get canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1
  }

  /**
   * Remove a workspace from history (e.g., when archived).
   */
  @action
  remove(workspaceId: string): void {
    const idx = this.history.indexOf(workspaceId)
    if (idx === -1) return

    this.history = this.history.filter((id) => id !== workspaceId)
    // Adjust index if necessary
    if (idx <= this.historyIndex) {
      this.historyIndex = Math.max(-1, this.historyIndex - 1)
    }
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }
    this.saveTimeout = setTimeout(() => {
      this.save()
    }, 500)
  }

  private async save(): Promise<void> {
    if (!this.loaded) return
    try {
      const data = {
        history: this.history,
        historyIndex: this.historyIndex,
      }
      await backend.invoke("save_json_config", {
        filename: "history.json",
        content: data,
      })
    } catch (err) {
      console.error("Failed to save history:", err)
    }
  }

  private async load(): Promise<void> {
    try {
      const result = await backend.invoke<{ history: string[]; historyIndex: number } | null>(
        "load_json_config",
        { filename: "history.json" }
      )
      if (result) {
        runInAction(() => {
          this.history = result.history ?? []
          this.historyIndex = result.historyIndex ?? this.history.length - 1
        })
      }
      this.loaded = true
    } catch (err) {
      console.error("Failed to load history:", err)
      this.loaded = true
    }
  }

  /**
   * For testing: reset state.
   */
  @action
  reset(): void {
    this.history = []
    this.historyIndex = -1
  }

  /**
   * For testing: get current state.
   */
  getState(): { history: string[]; historyIndex: number } {
    return { history: [...this.history], historyIndex: this.historyIndex }
  }
}

export const workspaceHistoryStore = new WorkspaceHistoryStore()
