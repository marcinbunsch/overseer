import { observable, action, makeObservable, runInAction } from "mobx"
import { gitService } from "../services/git"
import type { ChangedFile, Commit } from "../types"

type DiffStatus = "loading" | "error" | "done"

/**
 * Store for managing commit diff view state.
 * Each dialog instance should create its own store.
 */
export class CommitDiffViewStore {
  @observable selectedFile: ChangedFile
  @observable status: DiffStatus = "loading"
  @observable errorMessage: string | null = null
  @observable diff: string = ""

  /** Files changed in this commit */
  @observable files: ChangedFile[] = []
  @observable filesLoading = true
  @observable filesError: string | null = null

  private cache = new Map<string, string>()
  private workspacePath: string
  private commit: Commit

  constructor(workspacePath: string, commit: Commit) {
    makeObservable(this)
    this.workspacePath = workspacePath
    this.commit = commit
    // Initialize with a placeholder file until we load the list
    this.selectedFile = { status: "M", path: "" }
  }

  @action
  async loadFiles(): Promise<void> {
    this.filesLoading = true
    this.filesError = null

    try {
      const files = await gitService.listCommitFiles(this.workspacePath, this.commit.shortId)
      runInAction(() => {
        this.files = files
        this.filesLoading = false
        // Auto-select first file
        if (files.length > 0) {
          this.selectFile(files[0])
        }
      })
    } catch (err) {
      runInAction(() => {
        this.filesError = err instanceof Error ? err.message : String(err)
        this.filesLoading = false
      })
    }
  }

  @action
  async fetchDiff(file: ChangedFile): Promise<void> {
    const cacheKey = `${this.commit.shortId}:${file.path}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      this.status = "done"
      this.diff = cached
      this.errorMessage = null
      return
    }

    this.status = "loading"
    this.errorMessage = null

    try {
      const result = await gitService.getCommitDiff(
        this.workspacePath,
        this.commit.shortId,
        file.path,
        file.status
      )
      runInAction(() => {
        this.cache.set(cacheKey, result)
        this.status = "done"
        this.diff = result
      })
    } catch (err) {
      runInAction(() => {
        this.status = "error"
        this.errorMessage = err instanceof Error ? err.message : String(err)
      })
    }
  }

  @action
  selectFile(file: ChangedFile): void {
    this.selectedFile = file
    this.fetchDiff(file)
  }

  @action
  reset(): void {
    this.status = "loading"
    this.diff = ""
    this.errorMessage = null
    this.cache.clear()
    this.files = []
    this.filesLoading = true
    this.filesError = null
  }

  get fileName(): string {
    return this.selectedFile.path.split("/").pop() ?? this.selectedFile.path
  }
}

/**
 * Factory to create a new CommitDiffViewStore instance for each dialog
 */
export function createCommitDiffViewStore(
  workspacePath: string,
  commit: Commit
): CommitDiffViewStore {
  return new CommitDiffViewStore(workspacePath, commit)
}
