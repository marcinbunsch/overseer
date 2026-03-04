/**
 * HTTP backend implementation.
 *
 * Uses HTTP fetch for invoke calls and WebSocket for event subscriptions.
 * This allows the frontend to work in a browser without Tauri.
 */

import type { Backend, EventCallback, Unsubscribe } from "./types"

/** WebSocket connection state */
export type WsConnectionState = "disconnected" | "connecting" | "connected"

// Debug helper - timestamp for logs
const ts = () => new Date().toISOString().split("T")[1].slice(0, -1)

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

/** Pong response from server */
interface PongResponse {
  type: "pong"
}

/**
 * HTTP backend that communicates with the Overseer HTTP server.
 *
 * - Commands: POST /api/invoke/{command} with JSON body
 * - Events: WebSocket /ws/events with subscription patterns
 */
export class HttpBackend implements Backend {
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
  private connectionStateCallbacks = new Set<(state: WsConnectionState) => void>()
  private _authRequired = false
  private _connectionState: WsConnectionState = "disconnected"

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

  /**
   * Get the current WebSocket connection state.
   */
  get connectionState(): WsConnectionState {
    return this._connectionState
  }

  /**
   * Register a callback to be notified when the WebSocket connection state changes.
   *
   * @returns An unsubscribe function to remove the callback
   */
  onConnectionStateChange(callback: (state: WsConnectionState) => void): () => void {
    this.connectionStateCallbacks.add(callback)
    console.log(
      `[WS ${ts()}] 🔔 onConnectionStateChange callback registered (total: ${this.connectionStateCallbacks.size})`
    )
    return () => {
      this.connectionStateCallbacks.delete(callback)
      console.log(
        `[WS ${ts()}] 🔕 onConnectionStateChange callback removed (total: ${this.connectionStateCallbacks.size})`
      )
    }
  }

  /**
   * Update the connection state and notify all listeners.
   */
  private setConnectionState(state: WsConnectionState): void {
    const prev = this._connectionState
    if (prev === state) {
      console.log(`[WS ${ts()}] setConnectionState: already ${state}, skipping`)
      return
    }
    console.log(`[WS ${ts()}] 🔄 STATE CHANGE: ${prev} → ${state}`)
    this._connectionState = state
    console.log(`[WS ${ts()}] Notifying ${this.connectionStateCallbacks.size} state callbacks`)
    for (const callback of this.connectionStateCallbacks) {
      try {
        callback(state)
      } catch (e) {
        console.error("[HttpBackend] Connection state callback error:", e)
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
    console.log(`[WS ${ts()}] 👂 listen("${event}") called`)
    // Ensure WebSocket is connected
    await this.ensureWsConnected()
    console.log(`[WS ${ts()}] 👂 listen("${event}") - WS connected, adding subscription`)

    // Add subscription
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set())
      // Send subscribe message to server
      console.log(`[WS ${ts()}] 👂 New subscription pattern, sending to server: ${event}`)
      this.sendWsMessage({ type: "subscribe", pattern: event })
    }
    this.subscriptions.get(event)!.add(callback as EventCallback<unknown>)
    console.log(`[WS ${ts()}] 👂 Total subscriptions now: ${this.subscriptions.size}`)

    // Return unsubscribe function
    return () => {
      console.log(`[WS ${ts()}] 🔇 Unsubscribe called for "${event}"`)
      const callbacks = this.subscriptions.get(event)
      if (callbacks) {
        callbacks.delete(callback as EventCallback<unknown>)
        if (callbacks.size === 0) {
          this.subscriptions.delete(event)
          // Send unsubscribe message to server
          console.log(`[WS ${ts()}] 🔇 Last callback removed, sending unsubscribe to server`)
          this.sendWsMessage({ type: "unsubscribe", pattern: event })
        }
      }
      console.log(`[WS ${ts()}] 🔇 Total subscriptions now: ${this.subscriptions.size}`)
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
    // Don't look at me, this is Claude's doing, this is utter garbage
    if (origin.includes("localhost:51") || origin.includes("localhost:3000")) {
      return false
    }

    return true
  }

  private async ensureWsConnected(): Promise<void> {
    const wsReadyState = this.ws?.readyState
    const readyStateNames: Record<number, string> = {
      [WebSocket.CONNECTING]: "CONNECTING",
      [WebSocket.OPEN]: "OPEN",
      [WebSocket.CLOSING]: "CLOSING",
      [WebSocket.CLOSED]: "CLOSED",
    }
    const wsReadyStateStr =
      wsReadyState === undefined
        ? "null"
        : (readyStateNames[wsReadyState] ?? `unknown(${wsReadyState})`)

    console.log(
      `[WS ${ts()}] ▶ ensureWsConnected called | state=${this._connectionState} | wsConnecting=${this.wsConnecting} | ws.readyState=${wsReadyStateStr} | subscriptions=${this.subscriptions.size}`
    )

    // Only return early if we're truly connected (pong verified)
    if (this._connectionState === "connected" && this.ws?.readyState === WebSocket.OPEN) {
      console.log(`[WS ${ts()}] ✓ Already connected, returning early`)
      return
    }

    if (this.wsConnecting) {
      console.log(`[WS ${ts()}] ⏳ Another connection attempt in progress, entering wait loop...`)
      // Wait for existing connection attempt with timeout
      return new Promise((resolve, reject) => {
        let checkCount = 0
        const timeout = setTimeout(() => {
          console.log(`[WS ${ts()}] ⏳ Wait loop TIMEOUT after 10s (checked ${checkCount} times)`)
          clearInterval(check)
          reject(new Error("WebSocket connection timeout"))
        }, 10000)

        const check = setInterval(() => {
          checkCount++
          // Check for actual connected state (pong verified), not just WebSocket.OPEN
          if (this._connectionState === "connected") {
            console.log(
              `[WS ${ts()}] ⏳ Wait loop: connection succeeded after ${checkCount} checks`
            )
            clearInterval(check)
            clearTimeout(timeout)
            resolve()
          } else if (!this.wsConnecting) {
            // Connection attempt finished but not connected (failed)
            console.log(
              `[WS ${ts()}] ⏳ Wait loop: connection FAILED after ${checkCount} checks (wsConnecting=false but state=${this._connectionState})`
            )
            clearInterval(check)
            clearTimeout(timeout)
            reject(new Error("WebSocket connection failed"))
          }
          // Log every 20 checks (1 second)
          if (checkCount % 20 === 0) {
            console.log(
              `[WS ${ts()}] ⏳ Wait loop still waiting... checks=${checkCount} state=${this._connectionState} wsConnecting=${this.wsConnecting}`
            )
          }
        }, 50)
      })
    }

    console.log(`[WS ${ts()}] 🚀 Starting NEW connection attempt`)
    this.wsConnecting = true
    this.setConnectionState("connecting")

    return new Promise((resolve, reject) => {
      const attemptId = Math.random().toString(36).slice(2, 8) // Random ID for this attempt
      console.log(`[WS ${ts()}] [${attemptId}] Creating new WebSocket connection...`)

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        console.error(
          `[WS ${ts()}] [${attemptId}] ⏰ CONNECTION TIMEOUT (10s) - wsConnecting=${this.wsConnecting} state=${this._connectionState}`
        )
        this.wsConnecting = false
        this.setConnectionState("disconnected")
        if (this.ws) {
          console.log(`[WS ${ts()}] [${attemptId}] Closing WS due to timeout`)
          this.ws.close()
          this.ws = null
        }
        reject(new Error("WebSocket connection timeout"))
      }, 10000)

      try {
        // Include auth token as query param for WebSocket (can't use headers)
        const wsUrl = this.authToken ? `${this.wsUrl}?token=${this.authToken}` : this.wsUrl
        console.log(
          `[WS ${ts()}] [${attemptId}] Creating WebSocket to: ${wsUrl.replace(/token=.*/, "token=***")}`
        )
        this.ws = new WebSocket(wsUrl)

        // Track whether we've received pong for this connection attempt
        let pongReceived = false
        const isReconnect = this.hasConnectedBefore
        const wsCreatedAt = Date.now()

        this.ws.onopen = () => {
          const elapsed = Date.now() - wsCreatedAt
          console.log(
            `[WS ${ts()}] [${attemptId}] 📡 ONOPEN fired after ${elapsed}ms | isReconnect=${isReconnect}`
          )
          // WebSocket is open but not yet verified - send ping to confirm
          console.log(`[WS ${ts()}] [${attemptId}] Sending ping...`)
          this.ws?.send(JSON.stringify({ type: "ping" }))
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            // Check for pong response
            if ((data as PongResponse).type === "pong") {
              const elapsed = Date.now() - wsCreatedAt
              console.log(
                `[WS ${ts()}] [${attemptId}] 🏓 PONG received after ${elapsed}ms | pongReceived=${pongReceived}`
              )
              if (!pongReceived) {
                pongReceived = true
                clearTimeout(connectionTimeout)
                console.log(
                  `[WS ${ts()}] [${attemptId}] Clearing timeout, setting wsConnecting=false`
                )
                this.wsConnecting = false
                this.setConnectionState("connected")
                this.hasConnectedBefore = true
                console.log(
                  `[WS ${ts()}] [${attemptId}] ✅ CONNECTION ESTABLISHED (${isReconnect ? "reconnect" : "first connect"})`
                )

                // Resubscribe to all patterns
                const patterns = Array.from(this.subscriptions.keys())
                console.log(
                  `[WS ${ts()}] [${attemptId}] Resubscribing to ${patterns.length} patterns:`,
                  patterns
                )
                for (const pattern of patterns) {
                  this.sendWsMessage({ type: "subscribe", pattern })
                }

                // Notify reconnection handlers so they can catch up on missed events
                if (isReconnect) {
                  console.log(
                    `[WS ${ts()}] [${attemptId}] Notifying ${this.reconnectCallbacks.size} reconnect callbacks`
                  )
                  this.notifyReconnect()
                }

                console.log(`[WS ${ts()}] [${attemptId}] Resolving promise`)
                resolve()
              } else {
                console.log(`[WS ${ts()}] [${attemptId}] Ignoring duplicate pong`)
              }
              return
            }

            // Handle regular events (don't log each one - too noisy)
            this.handleWsEvent(data as WsEvent)
          } catch (e) {
            console.error(`[WS ${ts()}] [${attemptId}] Failed to parse WebSocket message:`, e)
          }
        }

        this.ws.onclose = (closeEvent) => {
          const elapsed = Date.now() - wsCreatedAt
          console.log(
            `[WS ${ts()}] [${attemptId}] 🔴 ONCLOSE fired after ${elapsed}ms | code=${closeEvent?.code ?? "?"} reason="${closeEvent?.reason ?? ""}" wasClean=${closeEvent?.wasClean ?? "?"}`
          )
          console.log(
            `[WS ${ts()}] [${attemptId}] State at close: pongReceived=${pongReceived} wsConnecting=${this.wsConnecting} state=${this._connectionState}`
          )
          clearTimeout(connectionTimeout)
          const wasConnecting = this.wsConnecting
          this.wsConnecting = false
          this.setConnectionState("disconnected")
          console.log(`[WS ${ts()}] [${attemptId}] Calling scheduleReconnect()`)
          this.scheduleReconnect()
          // Reject promise if we closed before pong was received
          if (!pongReceived && wasConnecting) {
            console.log(
              `[WS ${ts()}] [${attemptId}] ❌ Rejecting promise: closed before pong received`
            )
            reject(new Error("WebSocket closed before connection verified"))
          } else if (!pongReceived) {
            console.log(
              `[WS ${ts()}] [${attemptId}] Not rejecting: pong not received but wasConnecting=false (already handled)`
            )
          } else {
            console.log(
              `[WS ${ts()}] [${attemptId}] Connection was established then closed (graceful disconnect)`
            )
          }
        }

        this.ws.onerror = (error) => {
          const elapsed = Date.now() - wsCreatedAt
          console.error(`[WS ${ts()}] [${attemptId}] 💥 ONERROR fired after ${elapsed}ms:`, error)
          console.log(
            `[WS ${ts()}] [${attemptId}] State at error: pongReceived=${pongReceived} wsConnecting=${this.wsConnecting} state=${this._connectionState}`
          )
          clearTimeout(connectionTimeout)
          this.wsConnecting = false
          this.setConnectionState("disconnected")
          console.log(`[WS ${ts()}] [${attemptId}] Calling scheduleReconnect() after error`)
          this.scheduleReconnect()
          if (!pongReceived) {
            console.log(`[WS ${ts()}] [${attemptId}] ❌ Rejecting promise due to error`)
            reject(error)
          }
        }
      } catch (e) {
        console.error(`[WS ${ts()}] [${attemptId}] 💥 Exception creating WebSocket:`, e)
        clearTimeout(connectionTimeout)
        this.wsConnecting = false
        this.setConnectionState("disconnected")
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
      console.log(`[WS ${ts()}] 📤 Sending: ${message.type} "${message.pattern}"`)
      this.ws.send(JSON.stringify(message))
    } else {
      const readyStateNames: Record<number, string> = {
        [WebSocket.CONNECTING]: "CONNECTING",
        [WebSocket.CLOSING]: "CLOSING",
        [WebSocket.CLOSED]: "CLOSED",
      }
      const stateStr =
        this.ws?.readyState !== undefined ? (readyStateNames[this.ws.readyState] ?? "?") : "null"
      console.log(
        `[WS ${ts()}] ⚠️ Cannot send (ws.readyState=${stateStr}): ${message.type} "${message.pattern}"`
      )
    }
  }

  private scheduleReconnect(): void {
    console.log(
      `[WS ${ts()}] 📅 scheduleReconnect called | timerExists=${!!this.wsReconnectTimer} | subscriptions=${this.subscriptions.size}`
    )
    if (this.wsReconnectTimer) {
      console.log(`[WS ${ts()}] 📅 Timer already exists, skipping`)
      return
    }

    // Only reconnect if we have active subscriptions
    if (this.subscriptions.size > 0) {
      console.log(`[WS ${ts()}] 📅 Setting 2-second reconnect timer...`)
      this.wsReconnectTimer = setTimeout(() => {
        console.log(`[WS ${ts()}] ⏰ Reconnect timer FIRED`)
        this.wsReconnectTimer = null
        console.log(`[WS ${ts()}] ⏰ Calling ensureWsConnected from timer...`)
        this.ensureWsConnected().catch((e) => {
          console.error(`[WS ${ts()}] ⏰ ensureWsConnected FAILED in timer callback:`, e)
          console.log(`[WS ${ts()}] ⏰ Scheduling another reconnect...`)
          this.scheduleReconnect()
        })
      }, 2000)
    } else {
      console.log(`[WS ${ts()}] 📅 No subscriptions, NOT scheduling reconnect`)
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
    console.log(
      `[WS ${ts()}] 🔔 onReconnect callback registered (total: ${this.reconnectCallbacks.size})`
    )
    return () => {
      this.reconnectCallbacks.delete(callback)
      console.log(
        `[WS ${ts()}] 🔕 onReconnect callback removed (total: ${this.reconnectCallbacks.size})`
      )
    }
  }

  /**
   * Notify all reconnection handlers.
   * Called after WebSocket reconnects and resubscribes to patterns.
   */
  private notifyReconnect(): void {
    console.log(
      `[WS ${ts()}] 📢 notifyReconnect: calling ${this.reconnectCallbacks.size} callbacks`
    )
    let i = 0
    for (const callback of this.reconnectCallbacks) {
      try {
        console.log(`[WS ${ts()}] 📢 Calling reconnect callback ${++i}`)
        callback()
      } catch (e) {
        console.error("[HttpBackend] Reconnect callback error:", e)
      }
    }
    console.log(`[WS ${ts()}] 📢 notifyReconnect done`)
  }

  /**
   * Disconnect the WebSocket connection.
   * Call this when the backend is no longer needed.
   */
  disconnect(): void {
    console.log(`[WS ${ts()}] 🛑 disconnect() called`)
    if (this.wsReconnectTimer) {
      console.log(`[WS ${ts()}] 🛑 Clearing reconnect timer`)
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }

    if (this.ws) {
      console.log(`[WS ${ts()}] 🛑 Closing WebSocket`)
      this.ws.close()
      this.ws = null
    }

    console.log(
      `[WS ${ts()}] 🛑 Clearing ${this.subscriptions.size} subscriptions, ${this.reconnectCallbacks.size} reconnect callbacks`
    )
    this.subscriptions.clear()
    this.reconnectCallbacks.clear()
    this.authRequiredCallbacks.clear()
    this.connectionStateCallbacks.clear()
    this.setConnectionState("disconnected")
    console.log(`[WS ${ts()}] 🛑 disconnect() complete`)
  }
}

// Export a function to create HTTP backends (allows configuration)
export function createHttpBackend(baseUrl?: string): HttpBackend {
  return new HttpBackend(baseUrl)
}

// Export a default instance for the current origin
export const httpBackend = new HttpBackend()
