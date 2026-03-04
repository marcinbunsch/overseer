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
import { httpBackend } from "./http"

export type { Backend, EventCallback, Unsubscribe }

/**
 * Get the appropriate backend for the current environment.
 *
 * Detects whether we're running in Tauri or a browser and returns
 * the appropriate backend implementation.
 *
 * Detection priority:
 * 1. If __TAURI_INTERNALS__ exists -> TauriBackend (desktop app)
 * 2. If in browser (window exists, not Tauri) -> HttpBackend
 * 3. Otherwise -> TauriBackend (default for tests that mock Tauri)
 */
function getBackend(): Backend {
  // Check if we're running in Tauri (desktop app)
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return tauriBackend
  }

  // If we're in a browser but not in Tauri, we MUST use HTTP backend
  // (falling back to Tauri would fail since Tauri APIs don't exist)
  if (typeof window !== "undefined" && typeof fetch !== "undefined") {
    return httpBackend
  }

  // Default to Tauri (for tests that mock Tauri APIs)
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
