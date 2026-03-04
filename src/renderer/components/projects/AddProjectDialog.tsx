import { useState, useEffect } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import * as Select from "@radix-ui/react-select"
import { FolderOpen, Server, Check, AlertCircle, ChevronDown } from "lucide-react"
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { remoteServerStore } from "../../stores/RemoteServerStore"

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ProjectType = "local" | "remote"
type ValidationState = "idle" | "validating" | "valid" | "invalid"

export const AddProjectDialog = observer(function AddProjectDialog({
  open,
  onOpenChange,
}: AddProjectDialogProps) {
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [selectedServerId, setSelectedServerId] = useState<string>("")
  const [remotePath, setRemotePath] = useState("")
  const [validationState, setValidationState] = useState<ValidationState>("idle")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [isAdding, setIsAdding] = useState(false)

  const connectedServers = remoteServerStore.connectedServers
  const hasConnectedServers = connectedServers.length > 0
  const isInTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

  // Auto-select if there's only one server
  useEffect(() => {
    if (connectedServers.length === 1 && !selectedServerId) {
      setSelectedServerId(connectedServers[0].id)
    }
  }, [connectedServers, selectedServerId])

  const resetState = () => {
    setProjectType(null)
    setSelectedServerId("")
    setRemotePath("")
    setValidationState("idle")
    setValidationError(null)
    setIsGitRepo(false)
    setIsAdding(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
    }
    onOpenChange(newOpen)
  }

  const handleLocalSelect = async () => {
    const selected = await openFolderPicker({
      directory: true,
      multiple: false,
      title: "Select a project folder",
    })

    if (selected) {
      setIsAdding(true)
      try {
        await projectRegistry.addProject(selected)
        handleOpenChange(false)
      } finally {
        setIsAdding(false)
      }
    }
  }

  const handleValidatePath = async () => {
    if (!selectedServerId || !remotePath.trim()) {
      setValidationError("Please select a server and enter a path")
      return
    }

    setValidationState("validating")
    setValidationError(null)

    try {
      const server = remoteServerStore.getServer(selectedServerId)
      if (!server) {
        throw new Error("Server not found")
      }

      const backend = remoteServerStore.getBackend(server.url)
      if (!backend) {
        throw new Error("Server not connected")
      }

      const result = await backend.invoke<{ exists: boolean; isGitRepo: boolean }>(
        "validate_project_path",
        { path: remotePath.trim() }
      )

      if (result.exists) {
        setValidationState("valid")
        setIsGitRepo(result.isGitRepo)
      } else {
        setValidationState("invalid")
        setValidationError("Path does not exist or is not a directory")
      }
    } catch (err) {
      setValidationState("invalid")
      setValidationError(err instanceof Error ? err.message : "Validation failed")
    }
  }

  const handleAddRemoteProject = async () => {
    if (validationState !== "valid" || !selectedServerId) return

    const server = remoteServerStore.getServer(selectedServerId)
    if (!server) return

    setIsAdding(true)
    try {
      await projectRegistry.addRemoteProject(remotePath.trim(), server.url)
      handleOpenChange(false)
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Failed to add project")
    } finally {
      setIsAdding(false)
    }
  }

  // If in browser (not Tauri), skip the type selection and go straight to remote
  const showTypeSelection = isInTauri && projectType === null
  const showLocalPicker = isInTauri && projectType === "local"
  const showRemoteForm = projectType === "remote" || !isInTauri

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <AlertDialog.Title className="text-base font-semibold text-ovr-text-strong">
            Add Project
          </AlertDialog.Title>

          {showTypeSelection && (
            <>
              <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
                Choose where your project is located
              </AlertDialog.Description>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setProjectType("local")}
                  className="flex flex-1 flex-col items-center gap-2 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-4 transition-colors hover:border-ovr-accent hover:bg-ovr-bg-panel"
                >
                  <FolderOpen className="size-8 text-ovr-text-muted" />
                  <span className="text-sm font-medium text-ovr-text-primary">Local</span>
                  <span className="text-xs text-ovr-text-muted">On this computer</span>
                </button>

                <button
                  onClick={() => setProjectType("remote")}
                  disabled={!hasConnectedServers}
                  className="flex flex-1 flex-col items-center gap-2 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-4 transition-colors hover:border-ovr-accent hover:bg-ovr-bg-panel disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Server className="size-8 text-ovr-text-muted" />
                  <span className="text-sm font-medium text-ovr-text-primary">Remote</span>
                  <span className="text-xs text-ovr-text-muted">
                    {hasConnectedServers ? "On a remote server" : "No servers connected"}
                  </span>
                </button>
              </div>

              <div className="mt-4 flex justify-end">
                <AlertDialog.Cancel asChild>
                  <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">
                    Cancel
                  </button>
                </AlertDialog.Cancel>
              </div>
            </>
          )}

          {showLocalPicker && (
            <>
              <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
                Select a folder on your computer
              </AlertDialog.Description>

              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => setProjectType(null)}
                  className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs"
                >
                  Back
                </button>
                <button
                  onClick={handleLocalSelect}
                  disabled={isAdding}
                  className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {isAdding ? "Adding..." : "Choose Folder"}
                </button>
              </div>
            </>
          )}

          {showRemoteForm && (
            <>
              <AlertDialog.Description className="mt-2 text-sm text-ovr-text-muted">
                Select a server and enter the project path
              </AlertDialog.Description>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-ovr-text-muted">Server</label>
                  <Select.Root
                    value={selectedServerId || undefined}
                    onValueChange={(value) => {
                      setSelectedServerId(value)
                      setValidationState("idle")
                      setValidationError(null)
                    }}
                  >
                    <Select.Trigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2 text-sm text-ovr-text-primary focus:border-ovr-azure-500 focus:outline-none">
                      <Select.Value placeholder="Select a server..." />
                      <Select.Icon>
                        <ChevronDown className="size-3 text-ovr-text-dim" />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content
                        className="z-[100] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg"
                        position="popper"
                        sideOffset={4}
                      >
                        <Select.Viewport className="p-1">
                          {connectedServers.map((server) => (
                            <Select.Item
                              key={server.id}
                              value={server.id}
                              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                            >
                              <Select.ItemText>{server.name}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-ovr-text-muted">Project Path</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={remotePath}
                      onChange={(e) => {
                        setRemotePath(e.target.value)
                        setValidationState("idle")
                        setValidationError(null)
                      }}
                      placeholder="/home/user/projects/my-project"
                      className="ovr-input flex-1 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={handleValidatePath}
                      disabled={
                        !selectedServerId || !remotePath.trim() || validationState === "validating"
                      }
                      className="ovr-btn cursor-pointer px-3 py-2 text-xs disabled:opacity-50"
                    >
                      {validationState === "validating" ? "..." : "Validate"}
                    </button>
                  </div>
                </div>

                {validationState === "valid" && (
                  <div className="flex items-center gap-2 text-xs text-ovr-success">
                    <Check className="size-4" />
                    <span>
                      Path exists{isGitRepo ? " (Git repository)" : " (not a Git repository)"}
                    </span>
                  </div>
                )}

                {validationError && (
                  <div className="flex items-center gap-2 text-xs text-ovr-error">
                    <AlertCircle className="size-4" />
                    <span>{validationError}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end gap-3">
                {isInTauri && (
                  <button
                    onClick={() => setProjectType(null)}
                    className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs"
                  >
                    Back
                  </button>
                )}
                <AlertDialog.Cancel asChild>
                  <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">
                    Cancel
                  </button>
                </AlertDialog.Cancel>
                <button
                  onClick={handleAddRemoteProject}
                  disabled={validationState !== "valid" || isAdding}
                  className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {isAdding ? "Adding..." : "Add Project"}
                </button>
              </div>
            </>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
