import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { GitCommit } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { CommitDiffDialog } from "./CommitDiffDialog"

interface CommitsPaneProps {
  workspacePath: string
}

export const CommitsPane = observer(function CommitsPane({ workspacePath }: CommitsPaneProps) {
  // Get the cached store from WorkspaceStore instead of creating a new one
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const store = workspaceStore?.getCommitsStore()

  useEffect(() => {
    if (!store) return
    store.activate()
    return () => {
      store.deactivate()
    }
  }, [store])

  // Track running count changes for auto-refresh
  const runningCount = workspaceStore?.runningCount ?? 0

  useEffect(() => {
    if (!store) return
    store.onRunningCountChange(runningCount)
  }, [runningCount, store])

  if (!store) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
        No workspace selected
      </div>
    )
  }

  if (store.loading && store.commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
        Loading...
      </div>
    )
  }

  if (store.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-sm text-ovr-text-muted">
        <span className="text-ovr-bad">{store.error}</span>
        <button
          onClick={() => store.refresh()}
          className="rounded px-2 py-1 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          {store.commits.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
              No commits on this branch
            </div>
          )}
          {store.commits.map((commit) => (
            <button
              key={commit.shortId}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ovr-bg-elevated/50"
              onClick={() => store.setDiffCommit(commit)}
            >
              <GitCommit size={12} className="shrink-0 text-ovr-text-dim" />
              <span className="shrink-0 font-mono text-xs text-ovr-azure-400">
                {commit.shortId}
              </span>
              <span className="min-w-0 flex-1 truncate text-ovr-text-primary">
                {commit.message}
              </span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-ovr-border-subtle px-3 py-1.5">
          <span className="text-xs text-ovr-text-dim">
            {store.commits.length} commit{store.commits.length !== 1 ? "s" : ""} on branch
          </span>
          <button
            onClick={() => store.refresh()}
            disabled={store.loading}
            className="rounded px-2 py-0.5 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:opacity-50"
          >
            {store.loading ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      {store.diffCommit && (
        <CommitDiffDialog
          open={!!store.diffCommit}
          onOpenChange={(open) => {
            if (!open) store.setDiffCommit(null)
          }}
          workspacePath={workspacePath}
          commit={store.diffCommit}
        />
      )}
    </>
  )
})
