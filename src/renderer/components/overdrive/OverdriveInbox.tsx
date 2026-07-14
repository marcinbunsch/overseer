import { useEffect } from "react"
import { observer } from "mobx-react-lite"
import { backend } from "../../backend"
import { overdriveRunStore } from "../../stores/OverdriveRunStore"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { toastStore } from "../../stores/ToastStore"
import type { OverdriveRun } from "../../types"

const STATUS_DOT: Record<string, string> = {
  needsReview: "bg-ovr-ok",
  needsInput: "bg-ovr-warn",
  failed: "bg-ovr-bad",
}

function repoName(repoId: string): string {
  return projectRegistry.projects.find((p) => p.id === repoId)?.name ?? repoId
}

/** Open a run's workspace (chat + changed files) for review, like any workspace. */
async function openRun(run: OverdriveRun): Promise<void> {
  // Ensure the workspace is registered + chat indexed (backfills older runs),
  // then reload so it surfaces with its engine-assigned id.
  let workspaceId = run.workspaceId
  try {
    const ensured = await backend.invoke<string | null>("overdrive_ensure_workspace", {
      runId: run.id,
    })
    if (ensured) workspaceId = ensured
  } catch (err) {
    toastStore.show(String(err instanceof Error ? err.message : err) || "Could not open run")
    return
  }

  await projectRegistry.reload()
  const project = projectRegistry.projects.find((p) => p.id === run.repoId)
  const ws = project?.workspaces.find((w) => w.id === workspaceId || w.path === run.workspacePath)
  if (project && ws) {
    projectRegistry.selectProject(project.id)
    projectRegistry.selectWorkspace(ws.id)
  } else {
    toastStore.show("Run workspace not found (it may have been archived)")
  }
}

export const OverdriveInbox = observer(function OverdriveInbox() {
  useEffect(() => {
    overdriveRunStore.start()
  }, [])

  const runs = overdriveRunStore.actionableRuns
  if (runs.length === 0) return null

  return (
    <div data-testid="overdrive-inbox" className="mb-1 border-b border-ovr-border-subtle pb-1">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-ovr-text-dim uppercase">
          Overdrive
        </span>
        <span
          data-testid="overdrive-inbox-badge"
          className="rounded-full bg-ovr-bg-elevated px-1.5 py-0.5 text-[10px] text-ovr-text-muted"
        >
          {overdriveRunStore.actionableCount}
        </span>
      </div>
      <div className="flex flex-col">
        {runs.map((run) => (
          <button
            key={run.id}
            data-testid="overdrive-run-row"
            onClick={() => openRun(run)}
            className="group flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-ovr-text-primary transition-colors hover:bg-ovr-bg-elevated/50"
          >
            <span
              className={`size-2 shrink-0 rounded-full ${STATUS_DOT[run.status] ?? "bg-ovr-text-dim"}`}
            />
            <span className="min-w-0 flex-1 truncate">{run.branch ?? run.id}</span>
            <span className="shrink-0 text-[10px] text-ovr-text-dim">{repoName(run.repoId)}</span>
          </button>
        ))}
      </div>
    </div>
  )
})
