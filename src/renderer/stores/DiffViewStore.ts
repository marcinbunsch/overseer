import { observable, action, makeObservable, runInAction } from "mobx"
import { GitService } from "../services/git"
import type { ChangedFile } from "../types"

type DiffStatus = "loading" | "error" | "done"

/**
 * Store for managing diff view state in DiffDialog.
 * Each dialog instance should create its own store.
 */
export class DiffViewStore {
  @observable selectedFile: ChangedFile
  @observable status: DiffStatus = "loading"
  @observable errorMessage: string | null = null
  @observable diff: string = ""

  private cache = new Map<string, string>()
  private workspacePath: string
  private gitService: GitService

  constructor(workspacePath: string, initialFile: ChangedFile, gitService: GitService) {
    makeObservable(this)
    this.workspacePath = workspacePath
    this.selectedFile = initialFile
    this.gitService = gitService
  }

  @action
  async fetchDiff(file: ChangedFile): Promise<void> {
    // Use different cache keys for uncommitted vs branch changes, include submodule path
    const prefix = file.submodulePath ? `${file.submodulePath}:` : ""
    const cacheKey = file.isUncommitted
      ? `uncommitted:${prefix}${file.path}`
      : `branch:${prefix}${file.path}`
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
      let result: string

      if (file.submodulePath) {
        // File is inside a submodule - use submodule diff commands
        result = file.isUncommitted
          ? await this.gitService.getSubmoduleUncommittedDiff(
              this.workspacePath,
              file.submodulePath,
              file.path,
              file.status
            )
          : await this.gitService.getSubmoduleFileDiff(
              this.workspacePath,
              file.submodulePath,
              file.path,
              file.status
            )
      } else {
        // Regular file - use standard diff commands
        result = file.isUncommitted
          ? await this.gitService.getUncommittedDiff(this.workspacePath, file.path, file.status)
          : await this.gitService.getFileDiff(this.workspacePath, file.path, file.status)
      }

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
  }

  get fileName(): string {
    return this.selectedFile.path.split("/").pop() ?? this.selectedFile.path
  }
}

/**
 * Factory to create a new DiffViewStore instance for each dialog
 */
export function createDiffViewStore(
  workspacePath: string,
  initialFile: ChangedFile,
  gitService: GitService
): DiffViewStore {
  return new DiffViewStore(workspacePath, initialFile, gitService)
}
