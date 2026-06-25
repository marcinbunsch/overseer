import { backend as defaultBackend } from "../backend"
import type { Backend } from "../backend/types"
import { configStore } from "../stores/ConfigStore"
import type { ChangedFile, ChangedFilesResult, Commit, MergeResult } from "../types"

export interface WorkspaceInfo {
  path: string
  branch: string
}

export interface PrStatus {
  number: number
  state: "OPEN" | "MERGED" | "CLOSED"
  url: string
  is_draft: boolean
}

export interface ReviewPr {
  number: number
  title: string
  headRefName: string
  authorLogin: string
}

/**
 * GitService wraps git operations via the backend.
 * Can be instantiated with a specific backend for remote projects,
 * or use the default Tauri backend for local projects.
 */
export class GitService {
  private backend: Backend

  constructor(backend: Backend = defaultBackend) {
    this.backend = backend
  }

  async listWorkspaces(repoPath: string): Promise<WorkspaceInfo[]> {
    return this.backend.invoke<WorkspaceInfo[]>("list_workspaces", { repoPath })
  }

  async addWorkspace(repoPath: string, branch: string): Promise<string> {
    return this.backend.invoke<string>("add_workspace", { repoPath, branch })
  }

  async archiveWorkspace(repoPath: string, workspacePath: string): Promise<void> {
    return this.backend.invoke<void>("archive_workspace", { repoPath, workspacePath })
  }

  async listChangedFiles(workspacePath: string, mainBranch?: string): Promise<ChangedFilesResult> {
    try {
      return await this.backend.invoke<ChangedFilesResult>("list_changed_files", {
        workspacePath,
        mainBranch,
      })
    } catch (err) {
      console.error("[Git listChangedFiles error] Debug info:", {
        error: err,
        workspacePath,
      })
      throw err
    }
  }

  async listFiles(workspacePath: string): Promise<string[]> {
    return this.backend.invoke<string[]>("list_files", { workspacePath })
  }

  async checkMerge(workspacePath: string, mainBranch?: string): Promise<MergeResult> {
    return this.backend.invoke<MergeResult>("check_merge", { workspacePath, mainBranch })
  }

  async mergeIntoMain(workspacePath: string, mainBranch?: string): Promise<MergeResult> {
    return this.backend.invoke<MergeResult>("merge_into_main", { workspacePath, mainBranch })
  }

  async renameBranch(workspacePath: string, newName: string, mainBranch?: string): Promise<void> {
    return this.backend.invoke<void>("rename_branch", { workspacePath, newName, mainBranch })
  }

  async deleteBranch(repoPath: string, branchName: string): Promise<void> {
    return this.backend.invoke<void>("delete_branch", { repoPath, branchName })
  }

  async getFileDiff(
    workspacePath: string,
    filePath: string,
    fileStatus: string,
    mainBranch?: string
  ): Promise<string> {
    return this.backend.invoke<string>("get_file_diff", {
      workspacePath,
      filePath,
      fileStatus,
      mainBranch,
    })
  }

  async detectDefaultBranch(repoPath: string): Promise<string> {
    return this.backend.invoke<string>("detect_default_branch", { repoPath })
  }

  async getUncommittedDiff(
    workspacePath: string,
    filePath: string,
    fileStatus: string
  ): Promise<string> {
    return this.backend.invoke<string>("get_uncommitted_diff", {
      workspacePath,
      filePath,
      fileStatus,
    })
  }

  async getSubmoduleFileDiff(
    workspacePath: string,
    submodulePath: string,
    filePath: string,
    fileStatus: string
  ): Promise<string> {
    return this.backend.invoke<string>("get_submodule_file_diff", {
      workspacePath,
      submodulePath,
      filePath,
      fileStatus,
    })
  }

  async getSubmoduleUncommittedDiff(
    workspacePath: string,
    submodulePath: string,
    filePath: string,
    fileStatus: string
  ): Promise<string> {
    return this.backend.invoke<string>("get_submodule_uncommitted_diff", {
      workspacePath,
      submodulePath,
      filePath,
      fileStatus,
    })
  }

  async listCommits(workspacePath: string, mainBranch?: string): Promise<Commit[]> {
    return this.backend.invoke<Commit[]>("list_commits", { workspacePath, mainBranch })
  }

  async listCommitFiles(workspacePath: string, commitSha: string): Promise<ChangedFile[]> {
    return this.backend.invoke<ChangedFile[]>("list_commit_files", { workspacePath, commitSha })
  }

  async getCommitDiff(
    workspacePath: string,
    commitSha: string,
    filePath: string,
    fileStatus: string
  ): Promise<string> {
    return this.backend.invoke<string>("get_commit_diff", {
      workspacePath,
      commitSha,
      filePath,
      fileStatus,
    })
  }

  async getPrStatus(workspacePath: string, branch: string): Promise<PrStatus | null> {
    return this.backend.invoke<PrStatus | null>("get_pr_status", {
      workspacePath,
      branch,
      agentShell: configStore.agentShell || null,
    })
  }

  async listRecentBranches(repoPath: string): Promise<string[]> {
    return this.backend.invoke<string[]>("list_recent_branches", { repoPath })
  }

  async listReviewPrs(repoPath: string): Promise<ReviewPr[]> {
    return this.backend.invoke<ReviewPr[]>("list_review_prs", {
      repoPath,
      agentShell: configStore.agentShell || null,
    })
  }

  async isGitRepo(path: string): Promise<boolean> {
    return this.backend.invoke<boolean>("is_git_repo", { path })
  }
}

export const gitService = new GitService()
