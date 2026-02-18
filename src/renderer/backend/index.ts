/**
 * Backend abstraction layer.
 *
 * Provides a unified interface for frontend-backend communication,
 * supporting both Tauri (desktop) and Web (browser) environments.
 *
 * Usage:
 *   import { backend } from "./backend"
 *   const result = await backend.invoke("list_workspaces", { repoPath })
 *   const unlisten = await backend.listen("agent:stdout:123", callback)
 */

import type { Backend, EventCallback, Unsubscribe } from "./types"
import { tauriBackend } from "./tauri"

export type { Backend, EventCallback, Unsubscribe }

/**
 * Get the appropriate backend for the current environment.
 *
 * Currently only supports Tauri. Web backend will be added later.
 */
function getBackend(): Backend {
  // For now, always use Tauri
  // In the future, detect environment and return appropriate backend
  return tauriBackend
}

/**
 * The active backend instance.
 *
 * Use this for all backend communication:
 * - backend.invoke() for commands
 * - backend.listen() for event subscriptions
 */
export const backend = getBackend()
