import { observer } from "mobx-react-lite"
import { ChatWindow } from "../chat/ChatWindow"
import { projectRegistry } from "../../stores/ProjectRegistry"

export const MiddlePane = observer(function MiddlePane() {
  const workspace = projectRegistry.selectedWorkspace

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ovr-bg-app">
      {workspace?.isCreating ? (
        <div data-tauri-drag-region className="flex flex-1 items-center justify-center">
          <div className="text-center text-ovr-text-muted">
            <div className="mb-3 flex justify-center">
              <span className="size-5 animate-spin rounded-full border-2 border-ovr-azure-500 border-t-transparent" />
            </div>
            <p className="text-lg">Setting up workspace...</p>
            <p className="mt-1 text-sm">Creating git worktree for {workspace.branch}</p>
          </div>
        </div>
      ) : workspace ? (
        <ChatWindow workspace={workspace} />
      ) : (
        <div data-tauri-drag-region className="flex flex-1 items-center justify-center">
          <div className="text-center text-ovr-text-muted">
            <p className="text-lg">Select a workspace to start chatting</p>
            <p className="mt-1 text-sm">Add a project and select a workspace from the left pane</p>
          </div>
        </div>
      )}
    </div>
  )
})
