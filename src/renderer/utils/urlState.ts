/**
 * URL state management for persisting selection across reloads.
 *
 * Stores project, workspace, and chat IDs in query params so the app
 * can restore the same view after a page refresh.
 */

import { projectRegistry } from "../stores/ProjectRegistry"

const PROJECT_PARAM = "project"
const WORKSPACE_PARAM = "workspace"
const CHAT_PARAM = "chat"

/**
 * Save current selection state to URL query params and reload the page.
 */
export function reloadWithState(): void {
  const params = new URLSearchParams(window.location.search)

  // Preserve existing params (like auth token)
  if (projectRegistry.selectedProjectId) {
    params.set(PROJECT_PARAM, projectRegistry.selectedProjectId)
  }
  if (projectRegistry.selectedWorkspaceId) {
    params.set(WORKSPACE_PARAM, projectRegistry.selectedWorkspaceId)
  }

  // Get active chat ID from the selected workspace
  const workspaceStore = projectRegistry.selectedWorkspaceStore
  if (workspaceStore?.activeChatId) {
    params.set(CHAT_PARAM, workspaceStore.activeChatId)
  }

  // Build new URL with state params
  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname

  window.location.href = newUrl
}

/**
 * Restore selection state from URL query params.
 * Returns the chat ID to restore (if any) so the caller can select it after chats load.
 */
export function restoreFromUrl(): { chatId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get(PROJECT_PARAM)
  const workspaceId = params.get(WORKSPACE_PARAM)
  const chatId = params.get(CHAT_PARAM)

  // Clean up state params from URL (keep other params like token)
  params.delete(PROJECT_PARAM)
  params.delete(WORKSPACE_PARAM)
  params.delete(CHAT_PARAM)

  const newUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname

  window.history.replaceState({}, "", newUrl)

  // Restore selection if both project and workspace are specified
  if (projectId && workspaceId) {
    // Verify the project exists
    const project = projectRegistry.getProjectStore(projectId)
    if (project) {
      // Verify the workspace exists and is active
      const workspace = project.workspaces.find(
        (w) => w.id === workspaceId && !w.isArchived && !w.isArchiving
      )
      if (workspace) {
        projectRegistry.selectProject(projectId)
        projectRegistry.selectWorkspace(workspaceId)
        return { chatId }
      }
    }
  }

  return { chatId: null }
}
