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
