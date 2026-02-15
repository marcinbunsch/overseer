/**
 * Backend abstraction layer for Overseer.
 *
 * This module defines the interface between the frontend and backend,
 * allowing the same frontend code to work with:
 * - Tauri (invoke/listen)
 * - Web (fetch/WebSocket)
 */

/** Callback for event subscriptions */
export type EventCallback<T> = (payload: T) => void

/** Function to unsubscribe from an event */
export type Unsubscribe = () => void

/**
 * Backend interface that abstracts communication with the Rust backend.
 *
 * Implementations:
 * - TauriBackend: Uses Tauri's invoke/listen APIs
 * - WebBackend: Uses HTTP fetch and WebSocket (future)
 */
export interface Backend {
  /**
   * Call a backend command and return the result.
   *
   * @param command - The command name (e.g., "list_workspaces")
   * @param args - Arguments to pass to the command
   * @returns Promise resolving to the command result
   */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>

  /**
   * Subscribe to events from the backend.
   *
   * @param event - The event name (e.g., "agent:stdout:abc123")
   * @param callback - Function to call when event is received
   * @returns Promise resolving to an unsubscribe function
   */
  listen<T>(event: string, callback: EventCallback<T>): Promise<Unsubscribe>

  /**
   * Check if this backend is available/connected.
   */
  isAvailable(): boolean

  /**
   * Get the backend type identifier.
   */
  readonly type: "tauri" | "web"
}
