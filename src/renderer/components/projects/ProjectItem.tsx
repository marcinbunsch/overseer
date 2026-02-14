import { observer } from "mobx-react-lite"
import { useState, useEffect } from "react"
import { Ellipsis } from "lucide-react"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { toastStore } from "../../stores/ToastStore"
import type { ProjectStore } from "../../stores/ProjectStore"
import { WorkspaceList } from "./WorkspaceList"
import { ProjectSettingsDialog } from "./ProjectSettingsDialog"
import { NewWorkspaceDialog } from "./NewWorkspaceDialog"
import { eventBus } from "../../utils/eventBus"

interface ProjectItemProps {
  project: ProjectStore
}

export const ProjectItem = observer(function ProjectItem({ project }: ProjectItemProps) {
  const [expanded, setExpanded] = useState(true)
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isSelected = projectRegistry.selectedProjectId === project.id

  // Listen for keyboard shortcut to trigger new workspace dialog
  useEffect(() => {
    return eventBus.on("overseer:new_workspace", () => {
      if (isSelected && project.isGitRepo) {
        setExpanded(true)
        setNewWorkspaceOpen(true)
      }
    })
  }, [isSelected, project.isGitRepo])

  const handleSelect = () => {
    projectRegistry.selectProject(project.id)
    setExpanded(true)
  }

  const handleCreateWorkspace = (branch: string) => {
    projectRegistry.addWorkspace(project.id, branch)
    toastStore.show("Workspace created")
  }

  return (
    <>
      <div className="mx-1 mb-0.5">
        <div
          className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-2 text-sm transition-colors ${
            isSelected
              ? "bg-ovr-bg-elevated text-ovr-text-strong"
              : "text-ovr-text-primary hover:bg-ovr-bg-elevated/50"
          }`}
          onClick={handleSelect}
        >
          <button
            className="flex size-4 shrink-0 items-center justify-center rounded text-[10px] text-ovr-text-dim hover:text-ovr-text-muted"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? "▼" : "▶"}
          </button>
          <span className="flex-1 truncate font-medium">{project.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setSettingsOpen(true)
            }}
            className={`flex size-4 shrink-0 items-center justify-center rounded text-xs text-ovr-text-dim hover:text-ovr-text-muted ${
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } transition-opacity`}
            title="Project settings"
          >
            <Ellipsis className="size-3.5" />
          </button>
        </div>

        {expanded && (
          <div className="ml-3 mt-0.5">
            <WorkspaceList project={project} />

            {project.isGitRepo && (
              <button
                onClick={() => setNewWorkspaceOpen(true)}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-ovr-text-dim transition-colors hover:text-ovr-text-muted"
              >
                + Add workspace
              </button>
            )}
          </div>
        )}
      </div>
      {settingsOpen && (
        <ProjectSettingsDialog
          open={settingsOpen}
          onOpenChange={(open) => {
            if (!open) setSettingsOpen(false)
          }}
          project={project}
        />
      )}
      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
        onCreate={handleCreateWorkspace}
      />
    </>
  )
})
