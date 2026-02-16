import { getCurrentWindow } from "@tauri-apps/api/window"
import { confirm } from "@tauri-apps/plugin-dialog"
import { projectRegistry } from "../stores/ProjectRegistry"

export interface CloseRequestEvent {
  preventDefault: () => void
}

export interface WindowCloseDeps {
  hasRunningChats: () => boolean
  flushAllChats: () => Promise<void>
  showConfirm: (
    message: string,
    options: { title: string; kind: "info" | "warning" | "error" }
  ) => Promise<boolean>
  destroyWindow: () => Promise<void>
}

/**
 * Handle window close request - shows confirmation if chats are running,
 * flushes all chats to disk, then closes the window.
 */
export async function handleWindowCloseRequest(
  event: CloseRequestEvent,
  deps: WindowCloseDeps
): Promise<void> {
  if (deps.hasRunningChats()) {
    event.preventDefault()
    const shouldClose = await deps.showConfirm(
      "There are chats still running. Quitting will stop them. Are you sure you want to quit?",
      { title: "Quit Overseer?", kind: "warning" }
    )
    if (!shouldClose) {
      return
    }
    await deps.flushAllChats()
    await deps.destroyWindow()
  } else {
    event.preventDefault()
    await deps.flushAllChats()
    await deps.destroyWindow()
  }
}

/**
 * Create default dependencies using real Tauri APIs and stores.
 */
export function createDefaultDeps(): WindowCloseDeps {
  return {
    hasRunningChats: () => projectRegistry.hasRunningChats(),
    flushAllChats: () => projectRegistry.flushAllChats(),
    showConfirm: confirm,
    destroyWindow: () => getCurrentWindow().destroy(),
  }
}
