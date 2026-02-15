import { useCallback, useEffect, useRef } from "react"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { observer } from "mobx-react-lite"
import { LeftPane } from "./components/layout/LeftPane"
import { MiddlePane } from "./components/layout/MiddlePane"
import { RightPane } from "./components/layout/RightPane"
import { Toasts } from "./components/shared/Toasts"
import { SettingsDialog } from "./components/shared/SettingsDialog"
import { UpdateNotification } from "./components/shared/UpdateNotification"
import { configStore } from "./stores/ConfigStore"
import { projectRegistry } from "./stores/ProjectRegistry"
import { updateStore } from "./stores/UpdateStore"
import { backend } from "./backend"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { confirm } from "@tauri-apps/plugin-dialog"

async function handleWindowClose() {
  if (projectRegistry.hasRunningChats()) {
    const shouldClose = await confirm(
      "There are chats still running. Quitting will stop them. Are you sure you want to quit?",
      { title: "Quit Overseer?", kind: "warning" }
    )
    if (!shouldClose) {
      return
    }
  }
  await projectRegistry.flushAllChats()
  // Actually close the window now
  await getCurrentWindow().destroy()
}

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

    // Handle window close: warn if chats are running, then flush to disk
    // The Rust side prevents default close and emits this event so we can handle it
    const unlistenClose = backend.listen("window-close-requested", handleWindowClose)

    return () => {
      unlistenSettings.then((fn) => fn())
      unlistenClose.then((fn) => fn())
    }
  }, [])

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <LeftPane width={configStore.leftPaneWidth} />
        <DragHandle onDrag={handleLeftDrag} onDragEnd={handleLeftDragEnd} />
        <MiddlePane />
        <DragHandle onDrag={handleRightDrag} onDragEnd={handleRightDragEnd} />
        <RightPane width={configStore.rightPaneWidth} />
      </div>
      <Toasts />
      <UpdateNotification />
      <SettingsDialog
        open={configStore.settingsOpen}
        onOpenChange={(open) => configStore.setSettingsOpen(open)}
      />
    </>
  )
})
