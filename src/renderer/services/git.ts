import { invoke } from "@tauri-apps/api/core"
import { configStore } from "../stores/ConfigStore"
import type { ChangedFilesResult, MergeResult } from "../types"

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

class GitService {
  async listWorkspaces(repoPath: string): Promise<WorkspaceInfo[]> {
    return invoke<WorkspaceInfo[]>("list_workspaces", { repoPath })
  }

  async addWorkspace(repoPath: string, branch: string): Promise<string> {
    return invoke<string>("add_workspace", { repoPath, branch })
  }

  async archiveWorkspace(repoPath: string, workspacePath: string): Promise<void> {
    return invoke<void>("archive_workspace", { repoPath, workspacePath })
  }

  async listChangedFiles(workspacePath: string): Promise<ChangedFilesResult> {
    try {
      return await invoke<ChangedFilesResult>("list_changed_files", { workspacePath })
    } catch (err) {
      console.error("[Git listChangedFiles error] Debug info:", {
        error: err,
        workspacePath,
      })
      throw err
    }
  }

  async listFiles(workspacePath: string): Promise<string[]> {
    return invoke<string[]>("list_files", { workspacePath })
  }

  async checkMerge(workspacePath: string): Promise<MergeResult> {
    return invoke<MergeResult>("check_merge", { workspacePath })
  }

  async mergeIntoMain(workspacePath: string): Promise<MergeResult> {
    return invoke<MergeResult>("merge_into_main", { workspacePath })
  }

  async renameBranch(workspacePath: string, newName: string): Promise<void> {
    return invoke<void>("rename_branch", { workspacePath, newName })
  }

  async deleteBranch(repoPath: string, branchName: string): Promise<void> {
    return invoke<void>("delete_branch", { repoPath, branchName })
  }

  async getFileDiff(workspacePath: string, filePath: string, fileStatus: string): Promise<string> {
    return invoke<string>("get_file_diff", { workspacePath, filePath, fileStatus })
  }

  async getUncommittedDiff(
    workspacePath: string,
    filePath: string,
    fileStatus: string
  ): Promise<string> {
    return invoke<string>("get_uncommitted_diff", { workspacePath, filePath, fileStatus })
  }

  async getPrStatus(workspacePath: string, branch: string): Promise<PrStatus | null> {
    return invoke<PrStatus | null>("get_pr_status", {
      workspacePath,
      branch,
      agentShell: configStore.agentShell || null,
    })
  }

  async isGitRepo(path: string): Promise<boolean> {
    return invoke<boolean>("is_git_repo", { path })
  }
}

export const gitService = new GitService()
