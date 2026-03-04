/**
 * Backend factory for selecting the correct backend based on project source.
 *
 * Local projects use the Tauri backend, remote projects use their
 * server's HTTP backend.
 *
 * When running in a browser (not Tauri), all projects use HTTP backends.
 */

import type { Backend } from "./types"
import { tauriBackend } from "./tauri"
import { httpBackend } from "./http"
import { remoteServerStore } from "../stores/RemoteServerStore"

/**
 * Check if we're running in Tauri (desktop app).
 */
function isInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/**
 * Get the appropriate backend for a project.
 *
 * @param remoteServerUrl - If set, get the HTTP backend for this remote server
 * @returns The backend to use
 */
export function getBackendForProject(remoteServerUrl: string | undefined): Backend {
  // When running in browser (not Tauri), use HTTP backend for everything
  if (!isInTauri()) {
    // If it's a remote project with a specific URL, use that server's backend
    if (remoteServerUrl) {
      const backend = remoteServerStore.getBackend(remoteServerUrl)
      if (backend) {
        return backend
      }
    }
    // Otherwise use the default HTTP backend (current origin)
    return httpBackend
  }

  // Running in Tauri - use Tauri for local projects
  if (!remoteServerUrl) {
    return tauriBackend
  }

  // Remote project in Tauri - use the remote server's backend
  const backend = remoteServerStore.getBackend(remoteServerUrl)
  if (!backend) {
    console.warn(`No backend found for remote server ${remoteServerUrl}, falling back to Tauri`)
    return tauriBackend
  }

  return backend
}

/**
 * Check if a project is remote.
 */
export function isRemoteProject(remoteServerUrl: string | undefined): boolean {
  return !!remoteServerUrl
}

// Re-export tauriBackend for direct use when needed
export { tauriBackend }
