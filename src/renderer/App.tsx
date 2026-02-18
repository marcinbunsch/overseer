import { useCallback, useEffect, useRef } from "react"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { observer } from "mobx-react-lite"
import { LeftPane } from "./components/layout/LeftPane"
import { MiddlePane } from "./components/layout/MiddlePane"
import { RightPane } from "./components/layout/RightPane"
import { MobileHeader } from "./components/layout/MobileHeader"
import { Toasts } from "./components/shared/Toasts"
import { GlobalConfirmDialog } from "./components/shared/GlobalConfirmDialog"
import { SettingsDialog } from "./components/shared/SettingsDialog"
import { UpdateNotification } from "./components/shared/UpdateNotification"
import { configStore } from "./stores/ConfigStore"
import { updateStore } from "./stores/UpdateStore"
import { uiStore } from "./stores/UIStore"
import { backend } from "./backend"
import { handleWindowCloseRequest, createDefaultDeps } from "./utils/windowClose"

function DragHandle({
  onDrag,
  onDragEnd,
}: {
  onDrag: (deltaX: number, isStart: boolean) => void
  onDragEnd: () => void
}) {
  const startX = useRef(0)
  const isFirstMove = useRef(true)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startX.current = e.clientX
      isFirstMove.current = true

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current
        startX.current = ev.clientX
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
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [onDrag, onDragEnd]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ovr-azure-500"
      style={{ transition: "background-color 0.15s" }}
    />
  )
}

export default observer(function App() {
  useKeyboardShortcuts()
  const leftWidth = useRef(configStore.leftPaneWidth)
  const rightWidth = useRef(configStore.rightPaneWidth)

  const handleLeftDrag = useCallback((delta: number, isStart: boolean) => {
    if (isStart) leftWidth.current = configStore.leftPaneWidth
    const newWidth = Math.max(150, leftWidth.current + delta)
    leftWidth.current = newWidth
    configStore.leftPaneWidth = newWidth
  }, [])

  const handleLeftDragEnd = useCallback(() => {
    configStore.setLeftPaneWidth(leftWidth.current)
  }, [])

  const handleRightDrag = useCallback((delta: number, isStart: boolean) => {
    if (isStart) rightWidth.current = configStore.rightPaneWidth
    const newWidth = Math.max(200, rightWidth.current - delta)
    rightWidth.current = newWidth
    configStore.rightPaneWidth = newWidth
  }, [])

  const handleRightDragEnd = useCallback(() => {
    configStore.setRightPaneWidth(rightWidth.current)
  }, [])

  useEffect(() => {
    // Show the window after React has mounted to avoid white flash
    // (window starts hidden via `visible: false` in tauri.conf.json)
    backend.invoke("show_main_window")

    // Check for updates on startup (non-blocking)
    updateStore.checkForUpdates()

    const unlistenSettings = backend.listen("menu:settings", () => {
      configStore.setSettingsOpen(true)
    })

    // Window close handling is only available in Tauri
    const cleanupFns: Array<Promise<() => void>> = [unlistenSettings]

    if (backend.type === "tauri") {
      // Handle window close: warn if chats are running, then flush to disk
      // Using onCloseRequested which properly intercepts macOS traffic light close button
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const windowCloseDeps = createDefaultDeps()
        const unlistenClose = getCurrentWindow().onCloseRequested((event) =>
          handleWindowCloseRequest(event, windowCloseDeps)
        )
        cleanupFns.push(unlistenClose)
      })

      // Handle Cmd+Q / menu quit - same flow as close button
      import("@tauri-apps/api/event").then(({ listen }) => {
        const windowCloseDeps = createDefaultDeps()
        const unlistenQuit = listen("menu:quit", () => {
          // Create a synthetic event with preventDefault (which does nothing here,
          // since the Rust side doesn't actually initiate a close)
          const syntheticEvent = { preventDefault: () => {} }
          handleWindowCloseRequest(syntheticEvent, windowCloseDeps)
        })
        cleanupFns.push(unlistenQuit)
      })
    }

    return () => {
      cleanupFns.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  return (
    <>
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        {/* Mobile header with sidebar toggles */}
        <MobileHeader />

        {/* Main content area */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Left sidebar - hidden on mobile, shown via overlay when toggled */}
          <div
            className={`
              absolute inset-y-0 left-0 z-30 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0
              ${uiStore.leftSidebarOpen ? "translate-x-0" : "-translate-x-full"}
            `}
          >
            <LeftPane width={configStore.leftPaneWidth} />
          </div>

          {/* Drag handle - hidden on mobile */}
          <div className="hidden md:block">
            <DragHandle onDrag={handleLeftDrag} onDragEnd={handleLeftDragEnd} />
          </div>

          {/* Middle pane - always visible */}
          <MiddlePane />

          {/* Drag handle - hidden on mobile */}

          <div className="hidden md:block">
            <DragHandle onDrag={handleRightDrag} onDragEnd={handleRightDragEnd} />
          </div>

          {/* Right sidebar - hidden on mobile, shown via overlay when toggled */}
          <div
            className={`
              absolute inset-y-0 right-0 z-30 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0
              ${uiStore.rightSidebarOpen ? "translate-x-0" : "translate-x-full"}
            `}
          >
            <RightPane width={configStore.rightPaneWidth} />
          </div>

          {/* Backdrop for mobile sidebars */}
          {(uiStore.leftSidebarOpen || uiStore.rightSidebarOpen) && (
            <div
              className="absolute inset-0 z-20 bg-black/50 md:hidden"
              onClick={() => uiStore.closeAllSidebars()}
            />
          )}
        </div>
      </div>
      <Toasts />
      <GlobalConfirmDialog />
      <UpdateNotification />
      <SettingsDialog
        open={configStore.settingsOpen}
        onOpenChange={(open) => configStore.setSettingsOpen(open)}
      />
    </>
  )
})
