import { observer } from "mobx-react-lite"
import { useCallback, useRef } from "react"
import { TerminalPane } from "../terminal/TerminalPane"
import { ChangedFilesPane } from "../changes/ChangedFilesPane"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { configStore } from "../../stores/ConfigStore"

function HorizontalDragHandle({
  onDrag,
  onDragEnd,
}: {
  onDrag: (deltaY: number) => void
  onDragEnd: () => void
}) {
  const startY = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startY.current = e.clientY

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY.current
        startY.current = ev.clientY
        onDrag(delta)
      }

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        onDragEnd()
      }

      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
    },
    [onDrag, onDragEnd]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className="h-1 shrink-0 cursor-row-resize bg-ovr-border-subtle hover:bg-ovr-azure-500"
      style={{ transition: "background-color 0.15s" }}
    />
  )
}

export const RightPane = observer(function RightPane({ width }: { width: number }) {
  const workspace = projectRegistry.selectedWorkspace
  const project = projectRegistry.selectedProject
  const isGitRepo = project?.isGitRepo ?? true
  const changesHeight = useRef(configStore.changesHeight)

  const handleDrag = useCallback((delta: number) => {
    const newHeight = Math.max(80, changesHeight.current + delta)
    changesHeight.current = newHeight
    configStore.changesHeight = newHeight
  }, [])

  const handleDragEnd = useCallback(() => {
    configStore.setChangesHeight(changesHeight.current)
  }, [])

  return (
    <div
      className="flex h-full flex-col border-l border-ovr-border-subtle bg-ovr-bg-panel"
      style={{ width, minWidth: 200 }}
    >
      {/* Changes section (top) - only shown for git repos */}
      {isGitRepo && (
        <>
          <div className="flex items-center border-b border-ovr-border-subtle px-3 py-2">
            <span className="text-xs font-semibold text-ovr-text-muted">CHANGES</span>
          </div>
          <div
            className="flex flex-col overflow-hidden"
            style={{ height: configStore.changesHeight, minHeight: 80 }}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              {workspace?.isCreating ? (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  Workspace initializing...
                </div>
              ) : workspace ? (
                <ChangedFilesPane workspacePath={workspace.path} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  No workspace selected
                </div>
              )}
            </div>
            {/* Drag handle at bottom of changes pane */}
            <HorizontalDragHandle onDrag={handleDrag} onDragEnd={handleDragEnd} />
          </div>
        </>
      )}

      {/* Terminal section (bottom) */}
      <div className="flex shrink-0 items-center border-b border-ovr-border-subtle px-3 py-2">
        <span className="text-xs font-semibold text-ovr-text-muted">TERMINAL</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {workspace?.isCreating ? (
          <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
            Workspace initializing...
          </div>
        ) : workspace ? (
          <TerminalPane workspacePath={workspace.path} workspaceRoot={project?.path} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
            No workspace selected
          </div>
        )}
      </div>
    </div>
  )
})
