import { observer } from "mobx-react-lite"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { ProjectItem } from "./ProjectItem"

export const ProjectList = observer(function ProjectList() {
  const { projects } = projectRegistry

  if (projects.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-ovr-text-muted">
        No projects added yet.
        <br />
        Click &quot;+ Add&quot; to get started.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {projects.map((project) => (
        <ProjectItem key={project.id} project={project} />
      ))}
    </div>
  )
})
