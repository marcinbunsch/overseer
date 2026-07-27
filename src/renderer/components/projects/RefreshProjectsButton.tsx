import { observer } from "mobx-react-lite"
import { RefreshCw } from "lucide-react"
import { reloadWithState } from "../../utils/urlState"

export const RefreshProjectsButton = observer(function RefreshProjectsButton() {
  return (
    <button
      onClick={reloadWithState}
      className="flex size-5 items-center justify-center rounded text-ovr-text-dim transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
      title="Refresh projects and workspaces"
      aria-label="Refresh projects and workspaces"
    >
      <RefreshCw size={13} />
    </button>
  )
})
