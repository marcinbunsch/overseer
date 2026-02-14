import { observer } from "mobx-react-lite"
import { open } from "@tauri-apps/plugin-dialog"
import { projectRegistry } from "../../stores/ProjectRegistry"

export const AddProjectButton = observer(function AddProjectButton() {
  const handleClick = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a project folder",
    })

    if (selected) {
      await projectRegistry.addProject(selected)
    }
  }

  return (
    <button
      onClick={handleClick}
      className="flex size-5 items-center justify-center rounded text-sm text-ovr-text-dim transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
      title="Add Project"
    >
      +
    </button>
  )
})
