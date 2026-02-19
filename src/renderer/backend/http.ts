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
  private authToken: string | null = null
  private hasConnectedBefore = false
  private reconnectCallbacks = new Set<() => void>()
  private authRequiredCallbacks = new Set<() => void>()
  private _authRequired = false

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

    // Check for auth token in URL query params or localStorage
    this.loadAuthToken()
  }

  /**
   * Load auth token from URL query params or localStorage.
   * URL param takes precedence and is stored to localStorage for subsequent visits.
   */
  private loadAuthToken(): void {
    if (typeof window === "undefined") return

    // Check URL query param first
    const urlParams = new URLSearchParams(window.location.search)
    const tokenFromUrl = urlParams.get("token")

    if (tokenFromUrl) {
      this.authToken = tokenFromUrl
      // Store in localStorage for future visits
      try {
        localStorage.setItem("overseer_auth_token", tokenFromUrl)
      } catch {
        // localStorage might not be available
      }
      // Clean up URL (remove token param for security)
      urlParams.delete("token")
      const newUrl = urlParams.toString()
        ? `${window.location.pathname}?${urlParams.toString()}`
        : window.location.pathname
      window.history.replaceState({}, "", newUrl)
      return
    }

    // Fall back to localStorage
    try {
      const storedToken = localStorage.getItem("overseer_auth_token")
      if (storedToken) {
        this.authToken = storedToken
      }
    } catch {
      // localStorage might not be available
    }
  }

  /**
   * Set the authentication token.
   */
  setAuthToken(token: string | null): void {
    this.authToken = token
    // Clear auth required state when setting a new token
    if (token) {
      this._authRequired = false
    }
    try {
      if (token) {
        localStorage.setItem("overseer_auth_token", token)
      } else {
        localStorage.removeItem("overseer_auth_token")
      }
    } catch {
      // localStorage might not be available
    }

    // Reconnect WebSocket with new token if needed
    if (this.ws) {
      this.ws.close()
      this.ws = null
      if (this.subscriptions.size > 0) {
        this.ensureWsConnected().catch(console.error)
      }
    }
  }

  /**
   * Get the current authentication token.
   */
  getAuthToken(): string | null {
    return this.authToken
  }

  /**
   * Check if authentication is required but not yet provided.
   */
  get authRequired(): boolean {
    return this._authRequired
  }

  /**
   * Register a callback to be notified when authentication is required.
   * This is triggered when a 401 response is received.
   *
   * @returns An unsubscribe function to remove the callback
   */
  onAuthRequired(callback: () => void): () => void {
    this.authRequiredCallbacks.add(callback)
    return () => {
      this.authRequiredCallbacks.delete(callback)
    }
  }

  /**
   * Clear the auth required state (called after successful authentication).
   */
  clearAuthRequired(): void {
    this._authRequired = false
  }

  /**
   * Notify all auth required handlers.
   */
  private notifyAuthRequired(): void {
    this._authRequired = true
    for (const callback of this.authRequiredCallbacks) {
      try {
        callback()
      } catch (e) {
        console.error("[HttpBackend] Auth required callback error:", e)
      }
    }
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/api/invoke/${command}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ args: args ?? {} }),
    })

    if (!response.ok) {
      if (response.status === 401) {
        this.notifyAuthRequired()
        throw new Error("Authentication required. Please provide a valid token.")
      }
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
        // Include auth token as query param for WebSocket (can't use headers)
        const wsUrl = this.authToken ? `${this.wsUrl}?token=${this.authToken}` : this.wsUrl
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          this.wsConnecting = false
          const isReconnect = this.hasConnectedBefore
          this.hasConnectedBefore = true
          console.log(`[HttpBackend] WebSocket ${isReconnect ? "reconnected" : "connected"}`)

          // Resubscribe to all patterns
          for (const pattern of this.subscriptions.keys()) {
            this.sendWsMessage({ type: "subscribe", pattern })
          }

          // Notify reconnection handlers so they can catch up on missed events
          if (isReconnect) {
            this.notifyReconnect()
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
   * Register a callback to be notified when the WebSocket reconnects.
   * This is used by ChatStore to catch up on events missed during disconnection.
   *
   * @returns An unsubscribe function to remove the callback
   */
  onReconnect(callback: () => void): () => void {
    this.reconnectCallbacks.add(callback)
    return () => {
      this.reconnectCallbacks.delete(callback)
    }
  }

  /**
   * Notify all reconnection handlers.
   * Called after WebSocket reconnects and resubscribes to patterns.
   */
  private notifyReconnect(): void {
    for (const callback of this.reconnectCallbacks) {
      try {
        callback()
      } catch (e) {
        console.error("[HttpBackend] Reconnect callback error:", e)
      }
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
    this.reconnectCallbacks.clear()
    this.authRequiredCallbacks.clear()
  }
}

// Export a function to create HTTP backends (allows configuration)
export function createHttpBackend(baseUrl?: string): HttpBackend {
  return new HttpBackend(baseUrl)
}

// Export a default instance for the current origin
export const httpBackend = new HttpBackend()
