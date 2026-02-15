import { useState, useEffect } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { observer } from "mobx-react-lite"
import { X, Trash2 } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { toastStore } from "../../stores/ToastStore"
import type { ProjectStore } from "../../stores/ProjectStore"
import { ConfirmDialog } from "../shared/ConfirmDialog"

interface ProjectSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectStore
}

export const ProjectSettingsDialog = observer(function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
}: ProjectSettingsDialogProps) {
  // Component is conditionally rendered (unmounted when closed),
  // so initial state always reflects current project values
  const [initPrompt, setInitPrompt] = useState(project.initPrompt || "")
  const [prPrompt, setPrPrompt] = useState(project.prPrompt || "")
  const [postCreate, setPostCreate] = useState(project.postCreate || "")
  const [workspaceFilter, setWorkspaceFilter] = useState(project.workspaceFilter || "")
  const [useGithub, setUseGithub] = useState(project.useGithub !== false)
  const [allowMergeToMain, setAllowMergeToMain] = useState(project.allowMergeToMain !== false)
  const [pendingArchive, setPendingArchive] = useState(false)

  // Load fresh approvals from Rust when dialog opens
  useEffect(() => {
    if (open) {
      project.loadApprovals(true)
    }
  }, [open, project])

  // Approval display (derived from project store)
  const approvedTools = Array.from(project.approvedToolNames)
  const approvedCommands = Array.from(project.approvedCommandPrefixes)
  const hasApprovals = approvedTools.length > 0 || approvedCommands.length > 0

  const handleClearAllApprovals = () => {
    project.clearAllApprovals()
    toastStore.show("All approvals cleared")
  }

  const handleSave = () => {
    try {
      projectRegistry.updateProject(project.id, {
        initPrompt,
        prPrompt,
        postCreate,
        workspaceFilter,
        useGithub,
        allowMergeToMain,
      })
      toastStore.show("Settings saved")
      onOpenChange(false)
    } catch {
      toastStore.show("Failed to save settings")
    }
  }

  return (
    <>
      <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-200 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
            <div className="flex items-center justify-between">
              <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
                {project.name}
              </AlertDialog.Title>
              <AlertDialog.Cancel asChild>
                <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                  <X className="size-4" />
                </button>
              </AlertDialog.Cancel>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-6">
              {/* Left column: Project settings */}
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ovr-text-muted">
                    Init Prompt
                  </label>
                  <textarea
                    value={initPrompt}
                    onChange={(e) => setInitPrompt(e.target.value)}
                    placeholder="Prompt sent at the start of every new chat session..."
                    rows={1}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="min-h-20 w-full resize-none overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted focus:border-ovr-azure-500 focus:shadow-[var(--shadow-ovr-glow-soft)]"
                  />
                  <p className="mt-1 text-[11px] text-ovr-text-dim">
                    Added to the system prompt at the start of every new chat session.
                  </p>
                </div>

                {/* Git-specific settings */}
                {project.isGitRepo && (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ovr-text-muted">
                        PR Prompt
                      </label>
                      <textarea
                        value={prPrompt}
                        onChange={(e) => setPrPrompt(e.target.value)}
                        placeholder="Custom prompt used when creating pull requests..."
                        rows={1}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="min-h-20 w-full resize-none overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted focus:border-ovr-azure-500 focus:shadow-[var(--shadow-ovr-glow-soft)]"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-ovr-text-muted">
                        Post-create command
                      </label>
                      <input
                        type="text"
                        value={postCreate}
                        onChange={(e) => setPostCreate(e.target.value)}
                        placeholder="e.g. pnpm install"
                        className="ovr-input w-full text-xs"
                      />
                      <p className="mt-1 text-[11px] text-ovr-text-dim">
                        Runs in the workspace after a new workspace is created.
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-ovr-text-muted">
                        Workspace filter
                      </label>
                      <input
                        type="text"
                        value={workspaceFilter}
                        onChange={(e) => setWorkspaceFilter(e.target.value)}
                        placeholder="e.g. conductor|legacy"
                        className="ovr-input w-full font-mono text-xs"
                      />
                      <p className="mt-1 text-[11px] text-ovr-text-dim">
                        Regex pattern to hide workspaces. Matches against the full path.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={useGithub}
                          onChange={(e) => setUseGithub(e.target.checked)}
                          className="size-4 rounded border-ovr-border-subtle bg-ovr-bg-app accent-ovr-azure-500"
                        />
                        <span className="text-xs text-ovr-text-primary">Use GitHub</span>
                        <span className="text-xs text-ovr-text-dim">- show PR buttons</span>
                      </label>

                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allowMergeToMain}
                          onChange={(e) => setAllowMergeToMain(e.target.checked)}
                          className="size-4 rounded border-ovr-border-subtle bg-ovr-bg-app accent-ovr-azure-500"
                        />
                        <span className="text-xs text-ovr-text-primary">Allow merge to main</span>
                        <span className="text-xs text-ovr-text-dim">- show Merge button</span>
                      </label>
                    </div>
                  </>
                )}
              </div>

              {/* Right column: Approved permissions */}
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-ovr-text-muted">
                      Approved Permissions
                    </label>
                    {hasApprovals && (
                      <button
                        onClick={handleClearAllApprovals}
                        className="text-[11px] text-red-400 hover:text-red-300"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
                    {!hasApprovals ? (
                      <p className="text-center text-xs text-ovr-text-dim">
                        No permissions approved yet.
                        <br />
                        Approvals will appear here when you use "Approve all" in chat.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {/* Approved tools */}
                        {approvedTools.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium text-ovr-text-dim">
                              Tools
                            </p>
                            <div className="space-y-1">
                              {approvedTools.map((tool) => (
                                <div
                                  key={tool}
                                  className="group flex items-center justify-between rounded bg-ovr-bg-panel px-2 py-1"
                                >
                                  <span className="text-xs text-ovr-text-primary">{tool}</span>
                                  <button
                                    onClick={() => project.removeToolApproval(tool)}
                                    className="text-ovr-text-dim opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                                    title="Remove approval"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Approved commands */}
                        {approvedCommands.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium text-ovr-text-dim">
                              Commands
                            </p>
                            <div className="space-y-1">
                              {approvedCommands.map((cmd) => (
                                <div
                                  key={cmd}
                                  className="group flex items-center justify-between rounded bg-ovr-bg-panel px-2 py-1"
                                >
                                  <code className="text-xs text-ovr-text-primary">{cmd}</code>
                                  <button
                                    onClick={() => project.removeCommandApproval(cmd)}
                                    className="text-ovr-text-dim opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                                    title="Remove approval"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-ovr-text-dim">
                    Permissions are shared across all workspaces in this project.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <button
                className="ovr-btn-danger cursor-pointer px-3 py-1.5 text-xs"
                onClick={() => setPendingArchive(true)}
              >
                Archive project
              </button>
              <div className="flex gap-3">
                <AlertDialog.Cancel asChild>
                  <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">
                    Cancel
                  </button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs"
                    onClick={handleSave}
                  >
                    Save
                  </button>
                </AlertDialog.Action>
              </div>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <ConfirmDialog
        open={pendingArchive}
        onOpenChange={(archiveOpen) => {
          if (!archiveOpen) setPendingArchive(false)
        }}
        title="Archive project"
        description={`This will remove "${project.name}" from Overseer. The project files on disk will not be affected.`}
        confirmLabel="Archive"
        onConfirm={() => {
          setPendingArchive(false)
          onOpenChange(false)
          projectRegistry.removeProject(project.id)
        }}
      />
    </>
  )
})
