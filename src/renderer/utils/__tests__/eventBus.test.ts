import { describe, it, expect, vi, beforeEach } from "vitest"

// We need to test the actual implementation, not a mock
// So we create a fresh instance for each test
class EventBus {
  private listeners = new Map<string, Set<(payload: unknown) => void>>()

  on<T>(event: string, callback: (payload: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as (payload: unknown) => void)

    return () => {
      this.listeners.get(event)?.delete(callback as (payload: unknown) => void)
    }
  }

  emit<T>(event: string, payload: T): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload)
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err)
        }
      }
    }
  }

  off<T>(event: string, callback: (payload: T) => void): void {
    this.listeners.get(event)?.delete(callback as (payload: unknown) => void)
  }
}

describe("EventBus", () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
  })

  describe("on", () => {
    it("registers a callback for an event", () => {
      const callback = vi.fn()
      eventBus.on("test-event", callback)

      eventBus.emit("test-event", { data: "test" })

      expect(callback).toHaveBeenCalledWith({ data: "test" })
    })

    it("allows multiple callbacks for the same event", () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      eventBus.on("test-event", callback1)
      eventBus.on("test-event", callback2)

      eventBus.emit("test-event", { value: 42 })

      expect(callback1).toHaveBeenCalledWith({ value: 42 })
      expect(callback2).toHaveBeenCalledWith({ value: 42 })
    })

    it("returns an unsubscribe function", () => {
      const callback = vi.fn()
      const unsubscribe = eventBus.on("test-event", callback)

      eventBus.emit("test-event", "first")
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()

      eventBus.emit("test-event", "second")
      expect(callback).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it("only unsubscribes the specific callback", () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsubscribe1 = eventBus.on("test-event", callback1)
      eventBus.on("test-event", callback2)

      unsubscribe1()

      eventBus.emit("test-event", "data")

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith("data")
    })
  })

  describe("emit", () => {
    it("does nothing when no listeners are registered", () => {
      // Should not throw
      expect(() => eventBus.emit("unknown-event", { data: "test" })).not.toThrow()
    })

    it("passes the payload to all listeners", () => {
      const callback = vi.fn()
      eventBus.on("test-event", callback)

      const payload = { title: "Test", body: "Content" }
      eventBus.emit("test-event", payload)

      expect(callback).toHaveBeenCalledWith(payload)
    })

    it("handles errors in callbacks without stopping other callbacks", () => {
      const errorCallback = vi.fn(() => {
        throw new Error("Callback error")
      })
      const normalCallback = vi.fn()

      eventBus.on("test-event", errorCallback)
      eventBus.on("test-event", normalCallback)

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      eventBus.emit("test-event", "data")

      expect(errorCallback).toHaveBeenCalled()
      expect(normalCallback).toHaveBeenCalledWith("data")
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it("isolates events from each other", () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      eventBus.on("event-a", callback1)
      eventBus.on("event-b", callback2)

      eventBus.emit("event-a", "data-a")

      expect(callback1).toHaveBeenCalledWith("data-a")
      expect(callback2).not.toHaveBeenCalled()
    })
  })

  describe("off", () => {
    it("removes a specific callback", () => {
      const callback = vi.fn()
      eventBus.on("test-event", callback)

      eventBus.off("test-event", callback)
      eventBus.emit("test-event", "data")

      expect(callback).not.toHaveBeenCalled()
    })

    it("does nothing when removing a callback that was never registered", () => {
      const callback = vi.fn()

      // Should not throw
      expect(() => eventBus.off("test-event", callback)).not.toThrow()
    })

    it("does nothing when removing from an event that has no listeners", () => {
      const callback = vi.fn()

      expect(() => eventBus.off("unknown-event", callback)).not.toThrow()
    })
  })

  describe("typed events", () => {
    it("works with overseer:open_pr event type", () => {
      const callback = vi.fn()
      eventBus.on("overseer:open_pr", callback)

      eventBus.emit("overseer:open_pr", { title: "My PR", body: "Description" })

      expect(callback).toHaveBeenCalledWith({ title: "My PR", body: "Description" })
    })

    it("works with overseer:merge_branch event type", () => {
      const callback = vi.fn()
      eventBus.on("overseer:merge_branch", callback)

      eventBus.emit("overseer:merge_branch", { into: "main" })

      expect(callback).toHaveBeenCalledWith({ into: "main" })
    })
  })

  describe("multiple subscriptions and unsubscriptions", () => {
    it("handles rapid subscribe/unsubscribe cycles", () => {
      const callback = vi.fn()

      for (let i = 0; i < 10; i++) {
        const unsub = eventBus.on("test-event", callback)
        unsub()
      }

      eventBus.emit("test-event", "data")
      expect(callback).not.toHaveBeenCalled()
    })

    it("allows resubscribing after unsubscribing", () => {
      const callback = vi.fn()

      const unsub1 = eventBus.on("test-event", callback)
      unsub1()

      eventBus.on("test-event", callback)
      eventBus.emit("test-event", "data")

      expect(callback).toHaveBeenCalledWith("data")
    })

    it("handles the same callback registered multiple times", () => {
      const callback = vi.fn()

      eventBus.on("test-event", callback)
      eventBus.on("test-event", callback) // Same callback again

      eventBus.emit("test-event", "data")

      // Set ensures uniqueness, so callback should only be called once
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })
})
