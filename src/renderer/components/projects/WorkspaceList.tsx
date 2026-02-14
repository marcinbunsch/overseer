import { observer } from "mobx-react-lite"
import { useState } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import {
  AlertTriangle,
  CircleCheck,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestClosed,
  LoaderCircle,
} from "lucide-react"
import type { Workspace } from "../../types"
import { configStore } from "../../stores/ConfigStore"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { toastStore } from "../../stores/ToastStore"
import type { ProjectStore } from "../../stores/ProjectStore"

interface WorkspaceListProps {
  project: ProjectStore
}

export const WorkspaceList = observer(function WorkspaceList({ project }: WorkspaceListProps) {
  const [pendingArchive, setPendingArchive] = useState<Workspace | null>(null)
  const [deleteBranch, setDeleteBranch] = useState(false)

  const workspaces = project.activeWorkspaces

  if (workspaces.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-ovr-text-dim">No workspaces</div>
  }

  return (
    <>
      <div className="flex flex-col gap-px">
        {workspaces.map((wt) => {
          const isSelected = projectRegistry.selectedWorkspaceId === wt.id
          const wtStatus = projectRegistry.getWorkspaceStatus(wt.id)

          return (
            <div
              key={wt.id}
              className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                wt.isCreating
                  ? "cursor-wait text-ovr-text-dim"
                  : isSelected
                    ? "cursor-pointer bg-ovr-azure-500/10 text-ovr-azure-400"
                    : "cursor-pointer text-ovr-text-muted hover:bg-ovr-bg-elevated/50 hover:text-ovr-text-primary"
              }`}
              onClick={() => {
                if (wt.isCreating) return
                projectRegistry.selectProject(project.id)
                projectRegistry.selectWorkspace(wt.id)
              }}
            >
              {wt.isCreating ? (
                <LoaderCircle
                  className={`size-3 shrink-0 text-ovr-text-dim ${configStore.animationsEnabled ? "animate-spin" : ""}`}
                />
              ) : wtStatus === "needs_attention" ? (
                <AlertTriangle className="size-3 shrink-0 text-ovr-warn" />
              ) : wtStatus === "running" ? (
                <LoaderCircle
                  className={`size-3 shrink-0 text-ovr-azure-500 ${configStore.animationsEnabled ? "animate-spin" : ""}`}
                />
              ) : wtStatus === "done" ? (
                <CircleCheck className="size-3 shrink-0 text-ovr-ok" />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span className="flex-1 truncate">{wt.branch}</span>
              {wt.prState === "MERGED" ? (
                <span title={`PR #${wt.prNumber} merged`} className="shrink-0 text-ovr-diff-add">
                  <GitPullRequestArrow size={12} />
                </span>
              ) : wt.prState === "CLOSED" ? (
                <span title={`PR #${wt.prNumber} closed`} className="shrink-0 text-ovr-bad">
                  <GitPullRequestClosed size={12} />
                </span>
              ) : wt.prState === "OPEN" ? (
                <span title={`PR #${wt.prNumber}`} className="shrink-0 text-ovr-azure-400">
                  <GitPullRequest size={12} />
                </span>
              ) : null}
              {wt.path !== project.path && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingArchive(wt)
                  }}
                  className={`flex size-4 shrink-0 items-center justify-center rounded text-ovr-text-dim hover:text-ovr-bad ${
                    isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  } transition-opacity`}
                  title="Delete workspace"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="size-3"
                  >
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                    <path d="M14 3a1 1 0 0 1-1 1H3a1 1 0 0 1 0-2h3.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5H13a1 1 0 0 1 1 1M4.118 4l.782 10.14A1.5 1.5 0 0 0 6.395 15.5h3.21a1.5 1.5 0 0 0 1.495-1.36L11.882 4z" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </div>

      <AlertDialog.Root
        open={pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingArchive(null)
            setDeleteBranch(false)
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-100 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
            <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
              Delete workspace
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
              This will remove the &quot;{pendingArchive?.branch}&quot; workspace and delete its
              directory from disk. This cannot be undone.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Cancel</button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  className="ovr-btn-danger cursor-pointer px-3 py-1.5 text-xs"
                  onClick={async () => {
                    if (pendingArchive) {
                      const shouldDeleteBranch = deleteBranch
                      setPendingArchive(null)
                      setDeleteBranch(false)
                      await projectRegistry.archiveWorkspace(pendingArchive.id, shouldDeleteBranch)
                      toastStore.show(
                        shouldDeleteBranch ? "Workspace and branch deleted" : "Workspace deleted"
                      )
                    }
                  }}
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
            <div className="mt-3 flex justify-end">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ovr-text-muted">
                <input
                  type="checkbox"
                  checked={deleteBranch}
                  onChange={(e) => setDeleteBranch(e.target.checked)}
                  className="size-3.5 cursor-pointer accent-ovr-azure-500"
                />
                Also remove branch
              </label>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
})
