/**
 * Backend factory for selecting the correct backend based on project source.
 *
 * Local projects use the Tauri backend, remote projects use their
 * server's HTTP backend.
 */

import type { Backend } from "./types"
import { tauriBackend } from "./tauri"
import { remoteServerStore } from "../stores/RemoteServerStore"

/**
 * Get the appropriate backend for a project.
 *
 * @param remoteServerUrl - If set, get the HTTP backend for this remote server
 * @returns The backend to use, or tauriBackend for local projects
 */
export function getBackendForProject(remoteServerUrl: string | undefined): Backend {
  if (!remoteServerUrl) {
    return tauriBackend
  }

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
