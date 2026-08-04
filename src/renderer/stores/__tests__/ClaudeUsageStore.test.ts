import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { backend } from "../../backend"
import { eventBus } from "../../utils/eventBus"

// Mirrors the real ClaudeUsageStore's logic without the MobX decorators/singleton,
// so each test gets a fresh instance and controls the (mocked) eventBus
// subscription. NOTE: this is a hand-kept copy of ../ClaudeUsageStore.ts — keep the
// two in sync until the real singleton can be imported directly in tests.
const DEFAULT_ACCOUNT_KEY = "__default__"
const FETCH_INTERVAL_MS = 15 * 60 * 1000

interface AccountUsage {
  usageData: any
  lastFetchTime: number | null
  isLoading: boolean
}

function accountKey(configDir?: string): string {
  const trimmed = configDir?.trim()
  return trimmed ? trimmed : DEFAULT_ACCOUNT_KEY
}

class ClaudeUsageStore {
  private accounts = new Map<string, AccountUsage>()
  isSupported: boolean = true
  private scheduledChecks = new Map<string, ReturnType<typeof setTimeout>>()
  private unsubscribeFromEvents: (() => void) | null = null

  constructor() {
    this.unsubscribeFromEvents = eventBus.on("agent:turnComplete", (payload) => {
      if (payload.agentType === "claude") {
        this.checkAndFetchUsage(payload.claudeConfigDir)
      }
    })
  }

  dispose() {
    if (this.unsubscribeFromEvents) {
      this.unsubscribeFromEvents()
      this.unsubscribeFromEvents = null
    }
    for (const timeout of this.scheduledChecks.values()) {
      clearTimeout(timeout)
    }
    this.scheduledChecks.clear()
  }

  getUsageData(configDir?: string): any {
    return this.accounts.get(accountKey(configDir))?.usageData ?? null
  }

  private checkAndFetchUsage(configDir?: string) {
    const now = Date.now()
    const lastFetchTime = this.accounts.get(accountKey(configDir))?.lastFetchTime ?? null

    if (lastFetchTime && now - lastFetchTime < FETCH_INTERVAL_MS) {
      const timeUntilNextWindow = FETCH_INTERVAL_MS - (now - lastFetchTime)
      this.scheduleDelayedCheck(configDir, timeUntilNextWindow)
      return
    }

    void this.fetchUsage(configDir)
  }

  private scheduleDelayedCheck(configDir: string | undefined, delayMs: number) {
    const key = accountKey(configDir)
    const existing = this.scheduledChecks.get(key)
    if (existing) clearTimeout(existing)

    this.scheduledChecks.set(
      key,
      setTimeout(() => {
        this.scheduledChecks.delete(key)
        void this.fetchUsage(configDir)
      }, delayMs)
    )
  }

  async fetchUsage(configDir?: string) {
    if (!this.isSupported) return
    const key = accountKey(configDir)
    if (this.accounts.get(key)?.isLoading) return

    this.patchAccount(key, { isLoading: true })
    try {
      const response: any = await backend.invoke("fetch_claude_usage", {
        claudeConfigDir: configDir ?? null,
      })

      this.patchAccount(key, {
        usageData: {
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
        },
        lastFetchTime: Date.now(),
        isLoading: false,
      })
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
      this.patchAccount(key, { isLoading: false })
    }
  }

  private patchAccount(key: string, patch: Partial<AccountUsage>) {
    const current = this.accounts.get(key) ?? {
      usageData: null,
      lastFetchTime: null,
      isLoading: false,
    }
    this.accounts.set(key, { ...current, ...patch })
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

type TurnCompletePayload = { agentType: string; chatId: string; claudeConfigDir?: string }

describe("ClaudeUsageStore", () => {
  let store: ClaudeUsageStore
  let eventCallback: ((payload: TurnCompletePayload) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Capture the event callback when store subscribes
    vi.mocked(eventBus.on).mockImplementation((event, callback) => {
      if (event === "agent:turnComplete") {
        eventCallback = callback as (payload: TurnCompletePayload) => void
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
      expect(store.getUsageData()).toBeNull()
    })

    it("starts with isSupported = true", () => {
      expect(store.isSupported).toBe(true)
    })
  })

  describe("fetchUsage", () => {
    it("fetches and transforms usage data", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      await store.fetchUsage()

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage", { claudeConfigDir: null })
      const usage = store.getUsageData()
      expect(usage).not.toBeNull()
      expect(usage?.fiveHour?.utilization).toBe(50.0)
      expect(usage?.sevenDay?.utilization).toBe(30.0)
      expect(usage?.extraUsage?.utilization).toBe(50.0)
    })

    it("transforms snake_case to camelCase", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      await store.fetchUsage()

      const usage = store.getUsageData()
      expect(usage?.fiveHour?.resetsAt).toBe("2026-02-17T12:00:00Z")
      expect(usage?.extraUsage?.isEnabled).toBe(true)
      expect(usage?.extraUsage?.monthlyLimit).toBe(5000)
      expect(usage?.extraUsage?.usedCredits).toBe(2500.0)
    })

    it("passes the config dir to the backend for a custom account", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      await store.fetchUsage("~/.claude-work")

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage", {
        claudeConfigDir: "~/.claude-work",
      })
    })

    it("keeps usage separate per account", async () => {
      const defaultResponse = {
        ...mockUsageResponse,
        five_hour: { utilization: 20, resets_at: "" },
      }
      const workResponse = { ...mockUsageResponse, five_hour: { utilization: 80, resets_at: "" } }
      vi.mocked(backend.invoke).mockImplementation((_cmd: string, args?: any) =>
        Promise.resolve(args?.claudeConfigDir === "~/.claude-work" ? workResponse : defaultResponse)
      )

      await store.fetchUsage()
      await store.fetchUsage("~/.claude-work")

      // The custom account's fetch must not overwrite the default account's dials.
      expect(store.getUsageData()?.fiveHour?.utilization).toBe(20)
      expect(store.getUsageData("~/.claude-work")?.fiveHour?.utilization).toBe(80)
    })

    it("does not fetch if isSupported is false", async () => {
      store.isSupported = false

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
      await vi.runAllTimersAsync()

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage", { claudeConfigDir: null })
    })

    it("refreshes the account named in the turnComplete payload", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      eventCallback!({
        agentType: "claude",
        chatId: "test-chat",
        claudeConfigDir: "~/.claude-work",
      })
      await vi.runAllTimersAsync()

      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage", {
        claudeConfigDir: "~/.claude-work",
      })
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

      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()
      expect(backend.invoke).toHaveBeenCalledTimes(1)

      vi.clearAllMocks()

      vi.advanceTimersByTime(5 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      expect(backend.invoke).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(backend.invoke).toHaveBeenCalledTimes(1)
    })

    it("rate-limits each account independently", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      // Fetch the default account, then immediately a turn on a different account.
      eventCallback!({ agentType: "claude", chatId: "a" })
      await vi.runAllTimersAsync()
      vi.clearAllMocks()

      // Within the default account's window, but the custom account has never been
      // fetched, so it must fetch immediately rather than being rate-limited.
      eventCallback!({ agentType: "claude", chatId: "b", claudeConfigDir: "~/.claude-work" })
      await vi.runAllTimersAsync()

      expect(backend.invoke).toHaveBeenCalledTimes(1)
      expect(backend.invoke).toHaveBeenCalledWith("fetch_claude_usage", {
        claudeConfigDir: "~/.claude-work",
      })
    })

    it("fetches immediately if outside 15min window", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()
      expect(backend.invoke).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(16 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      expect(backend.invoke).toHaveBeenCalledTimes(2)
    })

    it("cancels previous scheduled check when new one is scheduled", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)
      expect(eventCallback).not.toBeNull()

      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      vi.advanceTimersByTime(5 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      vi.advanceTimersByTime(3 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      vi.advanceTimersByTime(7 * 60 * 1000)
      await vi.runAllTimersAsync()

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

      eventCallback!({ agentType: "claude", chatId: "test-chat" })
      await vi.runAllTimersAsync()

      vi.advanceTimersByTime(5 * 60 * 1000)
      eventCallback!({ agentType: "claude", chatId: "test-chat" })

      store.dispose()

      vi.clearAllMocks()
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)

      expect(backend.invoke).not.toHaveBeenCalled()
    })

    it("prevents further event handling after dispose", async () => {
      vi.mocked(backend.invoke).mockResolvedValue(mockUsageResponse)

      store.dispose()

      expect(store["unsubscribeFromEvents"]).toBeNull()
    })
  })
})
