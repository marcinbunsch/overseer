/**
 * Tauri backend implementation.
 *
 * Uses Tauri's invoke/listen APIs for communication with the Rust backend.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core"
import { listen as tauriListen } from "@tauri-apps/api/event"
import type { Backend, EventCallback, Unsubscribe } from "./types"

class TauriBackend implements Backend {
  readonly type = "tauri" as const

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return tauriInvoke<T>(command, args)
  }

  async listen<T>(event: string, callback: EventCallback<T>): Promise<Unsubscribe> {
    const unlisten = await tauriListen<T>(event, (e) => {
      callback(e.payload)
    })
    return unlisten
  }

  isAvailable(): boolean {
    // Check if we're running in Tauri
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  }
}

export const tauriBackend = new TauriBackend()
