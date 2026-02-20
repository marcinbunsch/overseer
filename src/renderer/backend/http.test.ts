import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: Event) => void) | null = null
  sentMessages: string[] = []

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    }, 10)
  }

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // Helper to simulate receiving a message
  receiveMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

// Store original globals
const originalWebSocket = globalThis.WebSocket
const originalFetch = globalThis.fetch

describe("HttpBackend", () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let mockWebSocket: typeof MockWebSocket

  beforeEach(() => {
    // Mock fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as typeof fetch

    // Mock WebSocket
    mockWebSocket = MockWebSocket as unknown as typeof MockWebSocket
    globalThis.WebSocket = mockWebSocket as unknown as typeof WebSocket

    // Clear any cached modules
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  describe("invoke", () => {
    it("sends POST request with correct headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { result: "test" } }),
      })

      const { httpBackend } = await import("./http")
      const result = await httpBackend.invoke("test_command", { arg1: "value1" })

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/invoke/test_command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: { arg1: "value1" } }),
      })
      expect(result).toEqual({ result: "test" })
    })

    it("serializes empty args correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: null }),
      })

      const { httpBackend } = await import("./http")
      await httpBackend.invoke("test_command")

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ args: {} }),
        })
      )
    })

    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })

      const { httpBackend } = await import("./http")
      await expect(httpBackend.invoke("test_command")).rejects.toThrow("HTTP 500")
    })

    it("throws and notifies auth required on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })

      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend("http://localhost:3000")

      const authCallback = vi.fn()
      backend.onAuthRequired(authCallback)

      await expect(backend.invoke("test_command")).rejects.toThrow("Authentication required")
      expect(authCallback).toHaveBeenCalled()
      expect(backend.authRequired).toBe(true)
    })

    it("clears auth required when token is set", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })

      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend("http://localhost:3000")

      // Trigger auth required
      await expect(backend.invoke("test_command")).rejects.toThrow()
      expect(backend.authRequired).toBe(true)

      // Set token should clear the flag
      backend.setAuthToken("test-token")
      expect(backend.authRequired).toBe(false)
    })

    it("throws on command error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "Command failed" }),
      })

      const { httpBackend } = await import("./http")
      await expect(httpBackend.invoke("test_command")).rejects.toThrow("Command failed")
    })
  })

  describe("listen", () => {
    it("connects WebSocket and subscribes", async () => {
      const { httpBackend } = await import("./http")
      const callback = vi.fn()

      const unsubscribe = await httpBackend.listen("test:event", callback)

      // Give WebSocket time to connect
      await new Promise((r) => setTimeout(r, 20))

      expect(typeof unsubscribe).toBe("function")
    })

    it("calls callback when matching event received", async () => {
      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend("http://localhost:3000")
      const callback = vi.fn()

      await backend.listen("test:event:123", callback)

      // Give WebSocket time to connect
      await new Promise((r) => setTimeout(r, 20))

      // Find the WebSocket instance and simulate a message
      const ws = (backend as unknown as { ws: MockWebSocket }).ws
      ws.receiveMessage({
        event_type: "test:event:123",
        payload: { data: "test" },
      })

      expect(callback).toHaveBeenCalledWith({ data: "test" })
    })

    it("supports wildcard patterns", async () => {
      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend("http://localhost:3000")
      const callback = vi.fn()

      await backend.listen("test:event:*", callback)

      // Give WebSocket time to connect
      await new Promise((r) => setTimeout(r, 20))

      const ws = (backend as unknown as { ws: MockWebSocket }).ws
      ws.receiveMessage({
        event_type: "test:event:123",
        payload: { data: "test" },
      })

      expect(callback).toHaveBeenCalledWith({ data: "test" })
    })

    it("unsubscribe removes listener", async () => {
      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend("http://localhost:3000")
      const callback = vi.fn()

      const unsubscribe = await backend.listen("test:event:123", callback)

      // Give WebSocket time to connect
      await new Promise((r) => setTimeout(r, 20))

      unsubscribe()

      const ws = (backend as unknown as { ws: MockWebSocket }).ws
      ws.receiveMessage({
        event_type: "test:event:123",
        payload: { data: "test" },
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe("isAvailable", () => {
    it("returns false in Vitest test environment", async () => {
      const { httpBackend } = await import("./http")
      // In the test environment (jsdom), isAvailable returns false
      // because we explicitly exclude test environments to avoid
      // breaking tests that mock Tauri APIs
      expect(httpBackend.isAvailable()).toBe(false)
    })
  })

  describe("pattern matching", () => {
    it("matches exact patterns", async () => {
      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend()
      const matchPattern = (
        backend as unknown as { matchPattern: (p: string, e: string) => boolean }
      ).matchPattern.bind(backend)

      expect(matchPattern("agent:event:123", "agent:event:123")).toBe(true)
      expect(matchPattern("agent:event:123", "agent:event:456")).toBe(false)
    })

    it("matches wildcard suffix", async () => {
      const { createHttpBackend } = await import("./http")
      const backend = createHttpBackend()
      const matchPattern = (
        backend as unknown as { matchPattern: (p: string, e: string) => boolean }
      ).matchPattern.bind(backend)

      expect(matchPattern("agent:event:*", "agent:event:123")).toBe(true)
      expect(matchPattern("agent:event:*", "agent:event:abc")).toBe(true)
      expect(matchPattern("agent:*", "agent:event:123")).toBe(true)
      expect(matchPattern("agent:event:*", "other:event:123")).toBe(false)
    })
  })
})

describe("getBackend auto-detection", () => {
  // These tests are environment-specific and the detection is tested
  // implicitly through the other tests. The current environment
  // returns tauriBackend because httpBackend.isAvailable() returns false
  // in the Vitest jsdom environment.

  it("returns tauriBackend in test environment", async () => {
    vi.resetModules()

    const { backend } = await import("./index")
    // In test environment, we default to tauri because httpBackend.isAvailable()
    // returns false (no valid location.origin)
    expect(backend.type).toBe("tauri")
  })
})

describe("HttpBackend connection state", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("initial state is disconnected", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    expect(backend.connectionState).toBe("disconnected")
  })

  it("changes to connecting then connected when WebSocket opens", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const stateChanges: string[] = []
    backend.onConnectionStateChange((state) => stateChanges.push(state))

    // Listen triggers WebSocket connection
    backend.listen("test:event", vi.fn()).catch(() => {})

    // Should immediately be connecting
    expect(backend.connectionState).toBe("connecting")
    expect(stateChanges).toContain("connecting")

    // Wait for WebSocket to open
    await new Promise((r) => setTimeout(r, 30))

    expect(backend.connectionState).toBe("connected")
    expect(stateChanges).toContain("connected")
  })

  it("changes to disconnected when WebSocket closes", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    // Connect first
    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 30))
    expect(backend.connectionState).toBe("connected")

    const stateChanges: string[] = []
    backend.onConnectionStateChange((state) => stateChanges.push(state))

    // Simulate WebSocket close
    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    ws.close()

    expect(backend.connectionState).toBe("disconnected")
    expect(stateChanges).toContain("disconnected")
  })

  it("unsubscribe removes callback", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    const unsubscribe = backend.onConnectionStateChange(callback)

    // Trigger a state change
    backend.listen("test:event", vi.fn()).catch(() => {})
    expect(callback).toHaveBeenCalled()

    // Clear and unsubscribe
    callback.mockClear()
    unsubscribe()

    // Trigger another state change - callback should not be called
    await new Promise((r) => setTimeout(r, 30))
    // State changed to connected, but callback was unsubscribed
    expect(callback).not.toHaveBeenCalled()
  })
})

describe("HttpBackend reconnection", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("onReconnect registers callback and returns unsubscribe function", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    const unsubscribe = backend.onReconnect(callback)

    expect(typeof unsubscribe).toBe("function")
  })

  it("onReconnect unsubscribe removes callback", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    const unsubscribe = backend.onReconnect(callback)

    // Verify callback is added
    const callbacks = (backend as unknown as { reconnectCallbacks: Set<() => void> })
      .reconnectCallbacks
    expect(callbacks.size).toBe(1)

    // Unsubscribe
    unsubscribe()
    expect(callbacks.size).toBe(0)
  })

  it("disconnect clears reconnect callbacks", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    backend.onReconnect(vi.fn())
    backend.onReconnect(vi.fn())

    const callbacks = (backend as unknown as { reconnectCallbacks: Set<() => void> })
      .reconnectCallbacks
    expect(callbacks.size).toBe(2)

    backend.disconnect()
    expect(callbacks.size).toBe(0)
  })

  it("does not notify reconnect on initial connection", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    backend.onReconnect(callback)

    // Listen triggers initial connection
    await backend.listen("test:event", vi.fn())

    // Wait for WebSocket to connect
    await new Promise((r) => setTimeout(r, 20))

    // Should not call callback on initial connection
    expect(callback).not.toHaveBeenCalled()
  })

  it("notifies reconnect callbacks after WebSocket reconnects", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()

    // Initial connection
    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    // Now register callback (after initial connection)
    backend.onReconnect(callback)

    // Get the WebSocket instance and simulate disconnect
    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    ws.close()

    // Wait for reconnect timer (2000ms) plus connection time
    // For faster testing, manually trigger by listening again
    await new Promise((r) => setTimeout(r, 50))

    // Manually trigger a reconnection by calling listen again
    // This will create a new WebSocket since the old one is closed
    await backend.listen("another:event", vi.fn())
    await new Promise((r) => setTimeout(r, 30))

    // The callback should be called because hasConnectedBefore is true
    expect(callback).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH TOKEN TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend auth token handling", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("includes auth token in Authorization header when set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    })

    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")
    backend.setAuthToken("my-secret-token")

    await backend.invoke("test_command")

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer my-secret-token",
        },
      })
    )
  })

  it("does not include Authorization header when no token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    })

    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")
    // No token set

    await backend.invoke("test_command")

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      })
    )
  })

  it("includes auth token in WebSocket URL when set", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")
    backend.setAuthToken("ws-token")

    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    expect(ws.url).toContain("?token=ws-token")
  })

  it("getAuthToken returns current token", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    expect(backend.getAuthToken()).toBeNull()

    backend.setAuthToken("test-token")
    expect(backend.getAuthToken()).toBe("test-token")

    backend.setAuthToken(null)
    expect(backend.getAuthToken()).toBeNull()
  })

  it("clearAuthRequired resets the auth required flag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })

    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await expect(backend.invoke("test_command")).rejects.toThrow()
    expect(backend.authRequired).toBe(true)

    backend.clearAuthRequired()
    expect(backend.authRequired).toBe(false)
  })

  it("onAuthRequired unsubscribe removes callback", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    const unsubscribe = backend.onAuthRequired(callback)

    const callbacks = (backend as unknown as { authRequiredCallbacks: Set<() => void> })
      .authRequiredCallbacks
    expect(callbacks.size).toBe(1)

    unsubscribe()
    expect(callbacks.size).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SUBSCRIPTION MESSAGE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend WebSocket subscription messages", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("sends subscribe message when first listener added", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await backend.listen("agent:event:*", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    const subscribeMsg = ws.sentMessages.find((m) => m.includes("subscribe"))
    expect(subscribeMsg).toBeDefined()

    const parsed = JSON.parse(subscribeMsg!)
    expect(parsed).toEqual({ type: "subscribe", pattern: "agent:event:*" })
  })

  it("sends unsubscribe message when last listener removed", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const unsubscribe = await backend.listen("test:pattern", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    ws.sentMessages = [] // Clear previous messages

    unsubscribe()

    const unsubscribeMsg = ws.sentMessages.find((m) => m.includes("unsubscribe"))
    expect(unsubscribeMsg).toBeDefined()

    const parsed = JSON.parse(unsubscribeMsg!)
    expect(parsed).toEqual({ type: "unsubscribe", pattern: "test:pattern" })
  })

  it("does not send unsubscribe when other listeners remain", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    // Add two listeners for same pattern
    const unsubscribe1 = await backend.listen("same:pattern", vi.fn())
    await backend.listen("same:pattern", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    ws.sentMessages = []

    // Remove first listener
    unsubscribe1()

    // Should NOT send unsubscribe since second listener remains
    const unsubscribeMsg = ws.sentMessages.find((m) => m.includes("unsubscribe"))
    expect(unsubscribeMsg).toBeUndefined()
  })

  it("resubscribes to all patterns on reconnect", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    // Subscribe to multiple patterns
    await backend.listen("pattern:one:*", vi.fn())
    await backend.listen("pattern:two:*", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    // Get first WS and close it
    const ws1 = (backend as unknown as { ws: MockWebSocket }).ws
    ws1.close()

    // Trigger reconnect by listening again
    await backend.listen("pattern:three:*", vi.fn())
    await new Promise((r) => setTimeout(r, 30))

    // Get new WS
    const ws2 = (backend as unknown as { ws: MockWebSocket }).ws
    expect(ws2).not.toBe(ws1)

    // Check that all patterns were resubscribed
    const subscriptions = ws2.sentMessages
      .filter((m) => m.includes('"type":"subscribe"'))
      .map((m) => JSON.parse(m).pattern)

    expect(subscriptions).toContain("pattern:one:*")
    expect(subscriptions).toContain("pattern:two:*")
    expect(subscriptions).toContain("pattern:three:*")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRUCTOR AND URL HANDLING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend constructor and URL handling", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("uses provided baseUrl", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://custom-host:8080")

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    })
    globalThis.fetch = mockFetch as typeof fetch

    await backend.invoke("test")

    expect(mockFetch).toHaveBeenCalledWith(
      "http://custom-host:8080/api/invoke/test",
      expect.any(Object)
    )
  })

  it("constructs WebSocket URL from baseUrl", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://example.com:3000")

    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    expect(ws.url).toBe("ws://example.com:3000/ws/events")
  })

  it("handles https to wss conversion", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("https://secure.example.com")

    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    expect(ws.url).toBe("wss://secure.example.com/ws/events")
  })

  it("backend type is web", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    expect(backend.type).toBe("web")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// MULTIPLE LISTENER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend multiple listeners", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("multiple callbacks for same pattern all receive events", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback1 = vi.fn()
    const callback2 = vi.fn()
    const callback3 = vi.fn()

    await backend.listen("shared:event:*", callback1)
    await backend.listen("shared:event:*", callback2)
    await backend.listen("shared:event:*", callback3)
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    ws.receiveMessage({
      event_type: "shared:event:123",
      payload: { test: true },
    })

    expect(callback1).toHaveBeenCalledWith({ test: true })
    expect(callback2).toHaveBeenCalledWith({ test: true })
    expect(callback3).toHaveBeenCalledWith({ test: true })
  })

  it("different patterns receive only matching events", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const agentCallback = vi.fn()
    const ptyCallback = vi.fn()

    await backend.listen("agent:event:*", agentCallback)
    await backend.listen("pty:data:*", ptyCallback)
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws

    // Send agent event
    ws.receiveMessage({
      event_type: "agent:event:123",
      payload: { type: "agent" },
    })

    expect(agentCallback).toHaveBeenCalledWith({ type: "agent" })
    expect(ptyCallback).not.toHaveBeenCalled()

    agentCallback.mockClear()

    // Send pty event
    ws.receiveMessage({
      event_type: "pty:data:456",
      payload: { type: "pty" },
    })

    expect(ptyCallback).toHaveBeenCalledWith({ type: "pty" })
    expect(agentCallback).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET ERROR HANDLING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend WebSocket error handling", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("rejects listen when WebSocket fails to connect", async () => {
    // Create a failing WebSocket mock
    class FailingWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSED = 3

      readyState = FailingWebSocket.CONNECTING
      onopen: (() => void) | null = null
      onerror: ((error: Event) => void) | null = null
      onclose: (() => void) | null = null

      constructor() {
        // Simulate connection failure
        setTimeout(() => {
          this.onerror?.(new Event("error"))
        }, 10)
      }

      send() {}
      close() {
        this.readyState = FailingWebSocket.CLOSED
      }
    }

    globalThis.WebSocket = FailingWebSocket as unknown as typeof WebSocket

    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await expect(backend.listen("test:event", vi.fn())).rejects.toThrow()
  })

  it("handles malformed WebSocket messages gracefully", async () => {
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket

    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    const callback = vi.fn()
    await backend.listen("test:event", callback)
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws

    // Send malformed JSON - should not crash
    ws.onmessage?.({ data: "not valid json {{{" })

    // Callback should not be called
    expect(callback).not.toHaveBeenCalled()

    // Backend should still work for valid messages
    ws.receiveMessage({
      event_type: "test:event",
      payload: { valid: true },
    })

    expect(callback).toHaveBeenCalledWith({ valid: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// DISCONNECT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("HttpBackend disconnect", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  it("closes WebSocket on disconnect", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const ws = (backend as unknown as { ws: MockWebSocket }).ws
    expect(ws.readyState).toBe(MockWebSocket.OPEN)

    backend.disconnect()

    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })

  it("clears all subscriptions on disconnect", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await backend.listen("pattern:1", vi.fn())
    await backend.listen("pattern:2", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    const subscriptions = (backend as unknown as { subscriptions: Map<string, unknown> })
      .subscriptions
    expect(subscriptions.size).toBe(2)

    backend.disconnect()

    expect(subscriptions.size).toBe(0)
  })

  it("clears all callback sets on disconnect", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    backend.onReconnect(vi.fn())
    backend.onAuthRequired(vi.fn())
    backend.onConnectionStateChange(vi.fn())

    backend.disconnect()

    const reconnectCallbacks = (backend as unknown as { reconnectCallbacks: Set<unknown> })
      .reconnectCallbacks
    const authRequiredCallbacks = (backend as unknown as { authRequiredCallbacks: Set<unknown> })
      .authRequiredCallbacks
    const connectionStateCallbacks = (
      backend as unknown as { connectionStateCallbacks: Set<unknown> }
    ).connectionStateCallbacks

    expect(reconnectCallbacks.size).toBe(0)
    expect(authRequiredCallbacks.size).toBe(0)
    expect(connectionStateCallbacks.size).toBe(0)
  })

  it("sets connection state to disconnected", async () => {
    const { createHttpBackend } = await import("./http")
    const backend = createHttpBackend("http://localhost:3000")

    await backend.listen("test:event", vi.fn())
    await new Promise((r) => setTimeout(r, 20))

    expect(backend.connectionState).toBe("connected")

    backend.disconnect()

    expect(backend.connectionState).toBe("disconnected")
  })
})
