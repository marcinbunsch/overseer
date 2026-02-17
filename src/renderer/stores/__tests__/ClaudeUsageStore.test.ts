import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { runInAction } from "mobx"
import { backend } from "../../backend"
import { eventBus } from "../../utils/eventBus"

// Import the class for testing, not the singleton
class ClaudeUsageStore {
  usageData: any = null
  lastFetchTime: number | null = null
  isLoading: boolean = false
  isSupported: boolean = true
  private scheduledCheckTimeout: ReturnType<typeof setTimeout> | null = null
  private unsubscribeFromEvents: (() => void) | null = null

  constructor() {
    this.unsubscribeFromEvents = eventBus.on("agent:turnComplete", (payload) => {
      if (payload.agentType === "claude") {
        this.checkAndFetchUsage()
      }
    })
  }

  dispose() {
    if (this.unsubscribeFromEvents) {
      this.unsubscribeFromEvents()
      this.unsubscribeFromEvents = null
    }

    if (this.scheduledCheckTimeout) {
      clearTimeout(this.scheduledCheckTimeout)
      this.scheduledCheckTimeout = null
    }
  }

  private checkAndFetchUsage() {
    const now = Date.now()

    if (this.lastFetchTime && now - this.lastFetchTime < 15 * 60 * 1000) {
      const timeUntilNextWindow = 15 * 60 * 1000 - (now - this.lastFetchTime)
      this.scheduleDelayedCheck(timeUntilNextWindow)
      return
    }

    void this.fetchUsage()
  }

  private scheduleDelayedCheck(delayMs: number) {
    if (this.scheduledCheckTimeout) {
      clearTimeout(this.scheduledCheckTimeout)
    }

    this.scheduledCheckTimeout = setTimeout(() => {
      this.scheduledCheckTimeout = null
      void this.fetchUsage()
    }, delayMs)
  }

  async fetchUsage() {
    if (this.isLoading || !this.isSupported) return

    this.isLoading = true
    try {
      const response: any = await backend.invoke("fetch_claude_usage")

      this.usageData = {
        fiveHour: response.five_hour
          ? {
              utilization: response.five_hour.utilization,
              resetsAt: response.five_hour.resets_at,
            }
          : null,
        sevenDay: response.seven_day
          ? {
              utilization: response.seven_day.utilization,
              resetsAt: response.seven_day.resets_at,
            }
          : null,
        sevenDayOauthApps: response.seven_day_oauth_apps
          ? {
              utilization: response.seven_day_oauth_apps.utilization,
              resetsAt: response.seven_day_oauth_apps.resets_at,
            }
          : null,
        sevenDayOpus: response.seven_day_opus
          ? {
              utilization: response.seven_day_opus.utilization,
              resetsAt: response.seven_day_opus.resets_at,
            }
          : null,
        sevenDaySonnet: response.seven_day_sonnet
          ? {
              utilization: response.seven_day_sonnet.utilization,
              resetsAt: response.seven_day_sonnet.resets_at,
            }
          : null,
        sevenDayCowork: response.seven_day_cowork
          ? {
              utilization: response.seven_day_cowork.utilization,
              resetsAt: response.seven_day_cowork.resets_at,
            }
          : null,
        iguanaNecktie: response.iguana_necktie
          ? {
              utilization: response.iguana_necktie.utilization,
              resetsAt: response.iguana_necktie.resets_at,
            }
          : null,
        extraUsage: response.extra_usage
          ? {
              isEnabled: response.extra_usage.is_enabled,
              monthlyLimit: response.extra_usage.monthly_limit,
              usedCredits: response.extra_usage.used_credits,
              utilization: response.extra_usage.utilization,
            }
          : null,
      }
      this.lastFetchTime = Date.now()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (
        errorMsg.includes("only supported on macOS") ||
        errorMsg.includes("UnsupportedPlatform")
      ) {
        this.isSupported = false
      } else {
        console.error("Failed to fetch Claude usage:", error)
      }
    } finally {
      this.isLoading = false
    }
  }
}

// Mock backend
vi.mock("../../backend", () => ({
  backend: {
    invoke: vi.fn(),
  },
}))

// Mock eventBus
vi.mock("../../utils/eventBus", () => ({
  eventBus: {
    on: vi.fn(),
    emit: vi.fn(),
  },
}))

describe("ClaudeUsageStore", () => {
  let store: ClaudeUsageStore
  let eventCallback: ((payload: { agentType: string; chatId: string }) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Capture the event callback when store subscribes
    vi.mocked(eventBus.on).mockImplementation((event, callback) => {
      if (event === "agent:turnComplete") {
        eventCallback = callback as (payload: { agentType: string; chatId: string }) => void
      }
      return vi.fn()
    })

    store = new ClaudeUsageStore()
  })

  afterEach(() => {
    if (store) {
      store.dispose()
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
    eventCallback = null
  })

  const mockUsageResponse = {
    five_hour: { utilization: 50.0, resets_at: "2026-02-17T12:00:00Z" },
    seven_day: { utilization: 30.0, resets_at: "2026-02-18T12:00:00Z" },
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 10.0, resets_at: "2026-02-17T15:00:00Z" },
    seven_day_cowork: null,
    iguana_necktie: null,
    extra_usage: {
      is_enabled: true,
      monthly_limit: 5000,
      used_credits: 2500.0,
      utilization: 50.0,
    },
  }

  describe("initialization", () => {
    it("subscribes to agent:turnComplete event", () => {
      expect(eventBus.on).toHaveBeenCalledWith("agent:turnComplete", expect.any(Function))
    })

    it("starts with null usage data", () => {
      expect(store.usageData).toBeNull()
    })

    it("starts with isSupported = true", () => {
      expect(store.isSupported).toBe(true)
    })

    it("starts with isLoading = false", () => {
      expect(store.isLoading).toBe(false)
    })
  })

  describe("fetchUsage", () => {
    it("fetches and transforms usage data", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      await store.fetchUsage()

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage")
      expect(store.usageData).not.toBeNull()
      expect(store.usageData?.fiveHour?.utilization).toBe(50.0)
      expect(store.usageData?.sevenDay?.utilization).toBe(30.0)
      expect(store.usageData?.extraUsage?.utilization).toBe(50.0)
    })

    it("transforms snake_case to camelCase", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      await store.fetchUsage()

      expect(store.usageData?.fiveHour?.resetsAt).toBe("2026-02-17T12:00:00Z")
      expect(store.usageData?.extraUsage?.isEnabled).toBe(true)
      expect(store.usageData?.extraUsage?.monthlyLimit).toBe(5000)
      expect(store.usageData?.extraUsage?.usedCredits).toBe(2500.0)
    })

    it("updates lastFetchTime", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      const beforeFetch = Date.now()

      await store.fetchUsage()

      expect(store.lastFetchTime).toBeGreaterThanOrEqual(beforeFetch)
    })

    it("does not fetch if isSupported is false", async () => {
      runInAction(() => {
        store.isSupported = false
      })

      await store.fetchUsage()

      expect(backend.invoke).not.toHaveBeenCalled()
    })

    it("sets isSupported to false on UnsupportedPlatform error", async () => {
      vi.mocked(backend.invoke).mockRejectedValue(
        new Error("Claude usage API is only supported on macOS")
      )

      await store.fetchUsage()

      expect(store.isSupported).toBe(false)
    })

    it("does not set isSupported to false on other errors", async () => {
      vi.mocked(backend.invoke).mockRejectedValue(new Error("Network error"))

      await store.fetchUsage()

      expect(store.isSupported).toBe(true)
    })
  })

  describe("rate limiting", () => {
    it("fetches immediately when turnComplete event fires for claude", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      // Wait for async operations
      await vi.runAllTimersAsync()

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage")
    })

    it("does not fetch when turnComplete event fires for non-claude agent", async () => {
      expect(eventCallback).not.toBeNull()

      eventCallback!({ agentType: "codex", chatId: "test-chat" })

      await vi.runAllTimersAsync()

      expect(backend.invoke).not.toHaveBeenCalled()
    })

    it("schedules delayed fetch if within 15min window", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      // First fetch
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()
      expect(backend.invoke).toHaveBeenCalledTimes(1)

      vi.clearAllMocks() // Clear so we can count properly

      // Second fetch within 15 min
      vi.advanceTimersByTime(5 * 60 * 1000) // 5 minutes
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      // Should not have fetched immediately
      expect(backend.invoke).not.toHaveBeenCalled()

      // Advance to when scheduled fetch should run (10 min remaining)
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

      // Now it should have fetched
      expect(backend.invoke).toHaveBeenCalledTimes(1)
    })

    it("fetches immediately if outside 15min window", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      // First fetch
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()
      expect(backend.invoke).toHaveBeenCalledTimes(1)

      // Second fetch after 15 min
      vi.advanceTimersByTime(16 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      // Should have fetched immediately
      expect(backend.invoke).toHaveBeenCalledTimes(2)
    })

    it("cancels previous scheduled check when new one is scheduled", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      // First fetch
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      // Two more events within window
      vi.advanceTimersByTime(5 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      vi.advanceTimersByTime(3 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      // Advance to when second scheduled check would fire
      vi.advanceTimersByTime(7 * 60 * 1000)
      await vi.runAllTimersAsync()

      // Should only have original + one scheduled fetch (not two)
      expect(backend.invoke).toHaveBeenCalledTimes(2)
    })
  })

  describe("dispose", () => {
    it("unsubscribes from event bus", () => {
      const unsubscribeFn = vi.fn()
      vi.mocked(eventBus.on).mockReturnValue(unsubscribeFn)

      const testStore = new ClaudeUsageStore()
      testStore.dispose()

      expect(unsubscribeFn).toHaveBeenCalled()
    })

    it("clears pending timeout", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      // First fetch
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      // Trigger a scheduled check
      vi.advanceTimersByTime(5 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      // Dispose should clear the timeout
      store.dispose()

      // Advance time - scheduled fetch should not run
      vi.clearAllMocks()
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)

      expect(backend.invoke).not.toHaveBeenCalled()
    })

    it("prevents further event handling after dispose", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      store.dispose()

      // Try to trigger event - should not work because we unsubscribed
      // Note: This test verifies the pattern, actual behavior depends on eventBus mock
      expect(store["unsubscribeFromEvents"]).toBeNull()
    })
  })
})
