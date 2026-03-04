import { observer } from "mobx-react-lite"
import { useCallback, useRef, useState, useEffect } from "react"
import classNames from "classnames"
import { ChevronDown, ChevronRight } from "lucide-react"
import { TerminalPane } from "../terminal/TerminalPane"
import { ChangedFilesPane } from "../changes/ChangedFilesPane"
import { CommitsPane } from "../changes/CommitsPane"
import { projectRegistry } from "../../stores/ProjectRegistry"
import { configStore } from "../../stores/ConfigStore"

const TERMINAL_OPEN_KEY = "overseer:terminalOpen"

function getTerminalOpenState(): boolean | null {
  try {
    const raw = localStorage.getItem(TERMINAL_OPEN_KEY)
    if (raw === null) return null
    return raw === "true"
  } catch {
    return null
  }
}

function setTerminalOpenState(open: boolean): void {
  try {
    localStorage.setItem(TERMINAL_OPEN_KEY, String(open))
  } catch {
    // localStorage unavailable
  }
}

type RightPaneTab = "changes" | "commits"

function HorizontalDragHandle({
  onDrag,
  onDragEnd,
}: {
  onDrag: (deltaY: number, isStart: boolean) => void
  onDragEnd: () => void
}) {
  const startY = useRef(0)
  const isFirstMove = useRef(true)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startY.current = e.clientY
      isFirstMove.current = true

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY.current
        startY.current = ev.clientY
        onDrag(delta, isFirstMove.current)
        isFirstMove.current = false
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
  const selectedTab = configStore.rightPaneTab as RightPaneTab

  // Terminal open state: use localStorage if set, otherwise use default from config
  const [terminalOpen, setTerminalOpen] = useState(() => {
    const stored = getTerminalOpenState()
    return stored !== null ? stored : configStore.terminalOpenByDefault
  })

  // Sync with configStore default when it loads
  const { loaded, terminalOpenByDefault } = configStore
  useEffect(() => {
    const stored = getTerminalOpenState()
    if (stored === null && loaded) {
      setTerminalOpen(terminalOpenByDefault)
    }
  }, [loaded, terminalOpenByDefault])

  const handleToggleTerminal = useCallback(() => {
    const newState = !terminalOpen
    setTerminalOpen(newState)
    setTerminalOpenState(newState)
  }, [terminalOpen])

  const handleDrag = useCallback((delta: number, isStart: boolean) => {
    if (isStart) changesHeight.current = configStore.changesHeight
    const newHeight = Math.max(80, changesHeight.current + delta)
    changesHeight.current = newHeight
    configStore.changesHeight = newHeight
  }, [])

  const handleDragEnd = useCallback(() => {
    configStore.setChangesHeight(changesHeight.current)
  }, [])

  const handleTabChange = useCallback((tab: RightPaneTab) => {
    configStore.setRightPaneTab(tab)
  }, [])

  return (
    <div
      className="flex h-full flex-col border-l border-ovr-border-subtle bg-ovr-bg-panel"
      style={{ width, minWidth: 200 }}
    >
      {/* Changes/Commits section (top) - only shown for git repos */}
      {isGitRepo && (
        <>
          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-ovr-border-subtle px-3 py-2">
            <button
              onClick={() => handleTabChange("changes")}
              className={classNames("cursor-pointer text-xs font-semibold transition-colors", {
                "text-ovr-text-muted": selectedTab === "changes",
                "text-ovr-text-dim hover:text-ovr-text-muted": selectedTab !== "changes",
              })}
            >
              CHANGES
            </button>
            <span className="text-ovr-text-dim">|</span>
            <button
              onClick={() => handleTabChange("commits")}
              className={classNames("cursor-pointer text-xs font-semibold transition-colors", {
                "text-ovr-text-muted": selectedTab === "commits",
                "text-ovr-text-dim hover:text-ovr-text-muted": selectedTab !== "commits",
              })}
            >
              COMMITS
            </button>
          </div>
          <div
            className={classNames("flex flex-col overflow-hidden", {
              "min-h-0 flex-1": !terminalOpen,
            })}
            style={terminalOpen ? { height: configStore.changesHeight, minHeight: 80 } : undefined}
          >
            <div className="min-h-0 flex-1 overflow-hidden">
              {workspace?.isCreating ? (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  Workspace initializing...
                </div>
              ) : workspace ? (
                selectedTab === "changes" ? (
                  <ChangedFilesPane workspacePath={workspace.path} />
                ) : (
                  <CommitsPane workspacePath={workspace.path} />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-ovr-text-muted">
                  No workspace selected
                </div>
              )}
            </div>
            {/* Drag handle at bottom of changes pane - only when terminal is open */}
            {terminalOpen && <HorizontalDragHandle onDrag={handleDrag} onDragEnd={handleDragEnd} />}
          </div>
        </>
      )}

      {/* Terminal section (bottom) */}
      <button
        onClick={handleToggleTerminal}
        className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-ovr-border-subtle px-3 py-2 transition-colors hover:bg-ovr-bg-panel-hover"
      >
        {terminalOpen ? (
          <ChevronDown size={14} className="text-ovr-text-dim" />
        ) : (
          <ChevronRight size={14} className="text-ovr-text-dim" />
        )}
        <span className="text-xs font-semibold text-ovr-text-muted">TERMINAL</span>
      </button>
      {terminalOpen && (
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
      )}
    </div>
  )
})
