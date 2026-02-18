/**
 * HTTP backend implementation.
 *
 * Uses HTTP fetch for invoke calls and WebSocket for event subscriptions.
 * This allows the frontend to work in a browser without Tauri.
 */

import type { Backend, EventCallback, Unsubscribe } from "./types"

/** Response format from the HTTP server */
interface InvokeResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/** Subscription request sent over WebSocket */
interface SubscriptionRequest {
  type: "subscribe" | "unsubscribe"
  pattern: string
}

/** Event received over WebSocket */
interface WsEvent {
  event_type: string
  payload: unknown
}

/**
 * HTTP backend that communicates with the Overseer HTTP server.
 *
 * - Commands: POST /api/invoke/{command} with JSON body
 * - Events: WebSocket /ws/events with subscription patterns
 */
class HttpBackend implements Backend {
  readonly type = "web" as const

  private baseUrl: string
  private wsUrl: string
  private ws: WebSocket | null = null
  private subscriptions = new Map<string, Set<EventCallback<unknown>>>()
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wsConnecting = false

  constructor(baseUrl?: string) {
    // Default to current origin, but handle Vite dev server specially
    let url = baseUrl
    if (!url && typeof window !== "undefined") {
      const origin = window.location.origin
      // If running on Vite dev server (port 1420), connect to HTTP server on port 6767
      if (origin.includes("localhost:1420") || origin.includes("127.0.0.1:1420")) {
        url = origin.replace(":1420", ":6767")
      } else {
        url = origin
      }
    }
    this.baseUrl = url || ""
    this.wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws/events"
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/api/invoke/${command}`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ args: args ?? {} }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result: InvokeResponse<T> = await response.json()

    if (!result.success) {
      throw new Error(result.error || "Unknown error")
    }

    return result.data as T
  }

  async listen<T>(event: string, callback: EventCallback<T>): Promise<Unsubscribe> {
    // Ensure WebSocket is connected
    await this.ensureWsConnected()

    // Add subscription
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set())
      // Send subscribe message to server
      this.sendWsMessage({ type: "subscribe", pattern: event })
    }
    this.subscriptions.get(event)!.add(callback as EventCallback<unknown>)

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(event)
      if (callbacks) {
        callbacks.delete(callback as EventCallback<unknown>)
        if (callbacks.size === 0) {
          this.subscriptions.delete(event)
          // Send unsubscribe message to server
          this.sendWsMessage({ type: "unsubscribe", pattern: event })
        }
      }
    }
  }

  isAvailable(): boolean {
    // HTTP backend is available if:
    // 1. We're in a browser (window exists)
    // 2. Not in Tauri (no __TAURI_INTERNALS__)
    // 3. Not in a test environment (has valid location.origin that's not the Vitest dev server)
    // 4. Has fetch available

    if (typeof window === "undefined" || typeof fetch === "undefined") {
      return false
    }

    if ("__TAURI_INTERNALS__" in window) {
      return false
    }

    // Check if we have a valid origin (excludes Node.js test environment)
    const origin = window.location?.origin
    if (!origin || origin === "null" || origin === "undefined") {
      return false
    }

    // Exclude Vitest/Jest test environments that use jsdom
    // These typically run on localhost with specific ports
    if (origin.includes("localhost:51") || origin.includes("localhost:3000")) {
      return false
    }

    return true
  }

  private async ensureWsConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.wsConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(check)
            resolve()
          }
        }, 50)
      })
    }

    this.wsConnecting = true

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl)

        this.ws.onopen = () => {
          this.wsConnecting = false
          console.log("[HttpBackend] WebSocket connected")

          // Resubscribe to all patterns
          for (const pattern of this.subscriptions.keys()) {
            this.sendWsMessage({ type: "subscribe", pattern })
          }

          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data: WsEvent = JSON.parse(event.data)
            this.handleWsEvent(data)
          } catch (e) {
            console.error("[HttpBackend] Failed to parse WebSocket message:", e)
          }
        }

        this.ws.onclose = () => {
          this.wsConnecting = false
          console.log("[HttpBackend] WebSocket disconnected")
          this.scheduleReconnect()
        }

        this.ws.onerror = (error) => {
          this.wsConnecting = false
          console.error("[HttpBackend] WebSocket error:", error)
          reject(error)
        }
      } catch (e) {
        this.wsConnecting = false
        reject(e)
      }
    })
  }

  private handleWsEvent(event: WsEvent): void {
    // Find matching subscriptions
    for (const [pattern, callbacks] of this.subscriptions) {
      if (this.matchPattern(pattern, event.event_type)) {
        for (const callback of callbacks) {
          try {
            callback(event.payload)
          } catch (e) {
            console.error("[HttpBackend] Error in event callback:", e)
          }
        }
      }
    }
  }

  /**
   * Match a subscription pattern against an event type.
   * Supports wildcard patterns like "agent:*" or "agent:event:*"
   */
  private matchPattern(pattern: string, eventType: string): boolean {
    if (pattern === eventType) {
      return true
    }

    // Handle wildcard at the end
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1)
      return eventType.startsWith(prefix)
    }

    return false
  }

  private sendWsMessage(message: SubscriptionRequest): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) {
      return
    }

    // Only reconnect if we have active subscriptions
    if (this.subscriptions.size > 0) {
      this.wsReconnectTimer = setTimeout(() => {
        this.wsReconnectTimer = null
        this.ensureWsConnected().catch((e) => {
          console.error("[HttpBackend] Reconnect failed:", e)
          this.scheduleReconnect()
        })
      }, 2000)
    }
  }

  /**
   * Disconnect the WebSocket connection.
   * Call this when the backend is no longer needed.
   */
  disconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.subscriptions.clear()
  }
}

// Export a function to create HTTP backends (allows configuration)
export function createHttpBackend(baseUrl?: string): HttpBackend {
  return new HttpBackend(baseUrl)
}

// Export a default instance for the current origin
export const httpBackend = new HttpBackend()
