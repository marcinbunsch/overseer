import { observer } from "mobx-react-lite"
import { ProjectList } from "../projects/ProjectList"
import { AddProjectButton } from "../projects/AddProjectButton"
import { debugStore } from "../../stores/DebugStore"

export const LeftPane = observer(function LeftPane({ width }: { width: number }) {
  return (
    <div
      className="flex h-full flex-col border-r border-ovr-border-subtle bg-ovr-bg-panel"
      style={{ width, minWidth: 150 }}
    >
      <div
        data-tauri-drag-region
        className="relative flex items-center justify-center border-b border-ovr-border-subtle px-3 pt-8 pb-2.5"
      >
        <span className="text-[11px] font-semibold tracking-wider text-ovr-text-dim uppercase">
          Projects
        </span>
        <div className="absolute right-3">
          <AddProjectButton />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <ProjectList />
      </div>
      {debugStore.showDevUI && (
        <div className="shrink-0 bg-ovr-dev px-3 py-1.5 text-center text-xs font-bold tracking-wide text-black uppercase">
          Dev Mode
        </div>
      )}
    </div>
  )
})
