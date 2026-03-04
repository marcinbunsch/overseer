import { useState } from "react"
import { observer } from "mobx-react-lite"
import { AddProjectDialog } from "./AddProjectDialog"

export const AddProjectButton = observer(function AddProjectButton() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="flex size-5 items-center justify-center rounded text-sm text-ovr-text-dim transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
        title="Add Project"
      >
        +
      </button>

      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
})
