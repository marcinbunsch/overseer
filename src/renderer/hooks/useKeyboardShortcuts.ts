import { useEffect } from "react"
import { projectRegistry } from "../stores/ProjectRegistry"
import { configStore } from "../stores/ConfigStore"
import { externalService } from "../services/external"
import { eventBus } from "../utils/eventBus"

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey) return

      const workspaceStore = projectRegistry.selectedWorkspaceStore

      // Cmd+Option shortcuts (use e.code for bracket keys since Option modifies the character)
      if (e.altKey) {
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault()
            workspaceStore?.selectPreviousChat()
            return
          case "ArrowRight":
            e.preventDefault()
            workspaceStore?.selectNextChat()
            return
        }
        switch (e.code) {
          case "BracketLeft":
            e.preventDefault()
            projectRegistry.selectPreviousWorkspace()
            return
          case "BracketRight":
            e.preventDefault()
            projectRegistry.selectNextWorkspace()
            return
        }
      }

      // Cmd shortcuts (no Alt)
      if (!e.altKey) {
        switch (e.key) {
          case "o": {
            e.preventDefault()
            const path = projectRegistry.selectedWorkspace?.path
            if (path) externalService.openInEditor(path)
            break
          }
          case "i": {
            e.preventDefault()
            const path = projectRegistry.selectedWorkspace?.path
            if (path) externalService.openInTerminal(path)
            break
          }
          case "[":
            e.preventDefault()
            projectRegistry.goBackInHistory()
            break
          case "]":
            e.preventDefault()
            projectRegistry.goForwardInHistory()
            break
          case "t":
            e.preventDefault()
            // Create new chat with default agent, or pending chat if no default
            workspaceStore?.newChat(configStore.defaultAgent ?? undefined)
            break
          case "n": {
            e.preventDefault()
            // Open new workspace dialog if a git project is selected
            const project = projectRegistry.selectedProject
            if (project?.isGitRepo) {
              eventBus.emit("overseer:new_workspace", undefined as never)
            }
            break
          }
          case "w":
            e.preventDefault()
            if (workspaceStore?.activeChatId) {
              workspaceStore.archiveChat(workspaceStore.activeChatId)
            }
            break
          case "u":
            e.preventDefault()
            eventBus.emit("overseer:open_diff_review", undefined as never)
            break
          case "l":
            e.preventDefault()
            eventBus.emit("overseer:focus_chat_input", undefined as never)
            break
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])
}
