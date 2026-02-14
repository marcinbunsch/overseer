import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { open } from "@tauri-apps/plugin-shell"
import { GitMerge, GitPullRequest, GitPullRequestArrow, GitPullRequestClosed } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { toolAvailabilityStore } from "../../stores/ToolAvailabilityStore"
import { eventBus } from "../../utils/eventBus"
import { STATUS_STYLES } from "../../constants/git"
import { DiffDialog } from "./DiffDialog"
import { MergeDialog } from "./MergeDialog"

interface ChangedFilesPaneProps {
  workspacePath: string
}

export const ChangedFilesPane = observer(function ChangedFilesPane({
  workspacePath,
}: ChangedFilesPaneProps) {
  // Get the cached store from WorkspaceStore instead of creating a new one
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  const store = workspaceStore?.getChangedFilesStore()

  useEffect(() => {
    if (!store) return
    store.activate()
    // Check gh availability for PR functionality
    toolAvailabilityStore.ensureGh()
    // Listen for keyboard shortcut to open diff review
    const unsubscribe = eventBus.on("overseer:open_diff_review", () => {
      store.openReview()
    })
    return () => {
      store.deactivate()
      unsubscribe()
    }
  }, [store])

  // Track running count changes for auto-refresh
  const runningCount = workspaceStore?.runningCount ?? 0
  const isSending = workspaceStore?.isSending ?? false

  useEffect(() => {
    if (!store) return
    store.onRunningCountChange(runningCount)
  }, [runningCount, store])

  const handleOpenPR = () => {
    if (store?.prStatus?.url) {
      open(store.prStatus.url)
    }
  }

  if (!store) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
        No workspace selected
      </div>
    )
  }

  if (store.loading && store.files.length === 0) {
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
          {store.uncommitted.length === 0 && store.files.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
              No changed files
            </div>
          )}
          {/* Uncommitted Changes Section */}
          {store.uncommitted.length > 0 && (
            <>
              <div className="sticky top-0 z-10 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5 text-xs font-medium text-ovr-text-muted">
                Uncommitted Changes
              </div>
              {store.uncommitted.map((file) => {
                const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
                return (
                  <button
                    key={`uncommitted-${file.status}-${file.path}`}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm hover:bg-ovr-bg-elevated/50"
                    onClick={() => store.setDiffFile(file)}
                  >
                    <span
                      className={`w-4 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                    >
                      {style.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ovr-text-primary">
                      {file.path}
                    </span>
                  </button>
                )
              })}
            </>
          )}

          {/* Branch Changes Section */}
          {store.files.length > 0 && (
            <>
              <div className="sticky top-0 z-10 border-b border-ovr-border-subtle bg-ovr-bg-panel px-3 py-1.5 text-xs font-medium text-ovr-text-muted">
                Branch Changes
              </div>
              {store.files.map((file) => {
                const style = STATUS_STYLES[file.status] ?? STATUS_STYLES["?"]
                return (
                  <button
                    key={`branch-${file.status}-${file.path}`}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm hover:bg-ovr-bg-elevated/50"
                    onClick={() => store.setDiffFile(file)}
                  >
                    <span
                      className={`w-4 shrink-0 text-center font-mono text-xs font-semibold ${style.color}`}
                    >
                      {style.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ovr-text-primary">
                      {file.path}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-ovr-border-subtle px-3 py-1.5">
          <span className="text-xs text-ovr-text-dim">
            {store.totalFileCount} file{store.totalFileCount !== 1 ? "s" : ""} changed
          </span>
          <div className="flex items-center gap-1">
            {/* Only show PR section if gh CLI is available (or not checked yet) and useGithub is enabled */}
            {!store.isDefaultBranch &&
              projectRegistry.selectedProject?.useGithub !== false &&
              (toolAvailabilityStore.gh === null || toolAvailabilityStore.gh.available) &&
              (store.prStatus ? (
                <button
                  onClick={handleOpenPR}
                  className={`flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors hover:bg-ovr-bg-elevated ${
                    store.prStatus.state === "MERGED"
                      ? "text-ovr-diff-add hover:text-ovr-diff-add"
                      : store.prStatus.state === "CLOSED"
                        ? "text-ovr-bad hover:text-ovr-bad"
                        : "text-ovr-azure-400 hover:text-ovr-azure-300"
                  }`}
                  title={`Open PR #${store.prStatus.number}${store.prStatus.state !== "OPEN" ? ` (${store.prStatus.state.toLowerCase()})` : ""}`}
                >
                  {store.prStatus.state === "MERGED" ? (
                    <GitPullRequestArrow size={12} />
                  ) : store.prStatus.state === "CLOSED" ? (
                    <GitPullRequestClosed size={12} />
                  ) : (
                    <GitPullRequest size={12} />
                  )}
                  PR #{store.prStatus.number}
                </button>
              ) : (
                <button
                  onClick={() => store.createPR()}
                  disabled={store.prLoading || isSending}
                  className="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:opacity-50"
                  title="Create a pull request"
                >
                  <GitPullRequest size={12} />
                  {store.prLoading ? "..." : "Create PR"}
                </button>
              ))}
            {!store.isDefaultBranch &&
              projectRegistry.selectedProject?.allowMergeToMain !== false && (
                <button
                  onClick={() => store.checkMerge()}
                  disabled={store.checking || store.merging || store.totalFileCount === 0}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:opacity-50"
                  title="Merge into main"
                >
                  <GitMerge size={12} />
                  {store.checking ? "Checking..." : store.merging ? "Merging..." : "Merge"}
                </button>
              )}
            <button
              onClick={() => store.refresh()}
              disabled={store.loading}
              className="rounded px-2 py-0.5 text-xs text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:opacity-50"
            >
              {store.loading ? "..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <MergeDialog
        open={store.showMergeConfirm}
        onOpenChange={(open) => store.setShowMergeConfirm(open)}
        onMerge={(archiveAfter, deleteBranch) => store.merge(archiveAfter, deleteBranch)}
      />

      {store.diffFile && (
        <DiffDialog
          open={!!store.diffFile}
          onOpenChange={(open) => {
            if (!open) store.setDiffFile(null)
          }}
          workspacePath={workspacePath}
          uncommittedFiles={store.uncommitted}
          branchFiles={store.files}
          initialFile={store.diffFile}
        />
      )}
    </>
  )
})
