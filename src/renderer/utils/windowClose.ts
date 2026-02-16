import { getCurrentWindow } from "@tauri-apps/api/window"
import { projectRegistry } from "../stores/ProjectRegistry"
import { confirmDialogStore } from "../stores/ConfirmDialogStore"

export interface CloseRequestEvent {
  preventDefault: () => void
}

export interface WindowCloseDeps {
  hasRunningChats: () => boolean
  flushAllChats: () => Promise<void>
  showConfirm: (options: {
    title: string
    description: string
    confirmLabel: string
  }) => Promise<boolean>
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
  // Always prevent default first - we control when the window actually closes
  event.preventDefault()

  const hasRunning = deps.hasRunningChats()
  if (hasRunning) {
    const shouldClose = await deps.showConfirm({
      title: "Quit Overseer?",
      description:
        "There are chats still running. Quitting will stop them. Are you sure you want to quit?",
      confirmLabel: "Quit",
    })
    if (!shouldClose) {
      return
    }
    await deps.flushAllChats()
    await deps.destroyWindow()
  } else {
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
    showConfirm: (options) => confirmDialogStore.confirm(options),
    destroyWindow: () => getCurrentWindow().destroy(),
  }
}
