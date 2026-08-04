import { observable, action, runInAction, makeObservable } from "mobx"
import { backend } from "../backend"
import { eventBus } from "../utils/eventBus"

export interface UsagePeriod {
  utilization: number
  resetsAt: string | null
}

export interface ExtraUsage {
  isEnabled: boolean
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null
}

export interface ClaudeUsageData {
  fiveHour: UsagePeriod | null
  sevenDay: UsagePeriod | null
  sevenDayOauthApps: UsagePeriod | null
  sevenDayOpus: UsagePeriod | null
  sevenDaySonnet: UsagePeriod | null
  sevenDayCowork: UsagePeriod | null
  iguanaNecktie: UsagePeriod | null
  extraUsage: ExtraUsage | null
}

// Backend response types (snake_case from Rust)
interface BackendUsagePeriod {
  utilization: number
  resets_at: string
}

interface BackendExtraUsage {
  is_enabled: boolean
  monthly_limit: number | null
  used_credits: number | null
  utilization: number | null
}

interface BackendClaudeUsageResponse {
  five_hour: BackendUsagePeriod | null
  seven_day: BackendUsagePeriod | null
  seven_day_oauth_apps: BackendUsagePeriod | null
  seven_day_opus: BackendUsagePeriod | null
  seven_day_sonnet: BackendUsagePeriod | null
  seven_day_cowork: BackendUsagePeriod | null
  iguana_necktie: BackendUsagePeriod | null
  extra_usage: BackendExtraUsage | null
}

const FETCH_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

// A chat can run under a custom Claude account via its project's CLAUDE_CONFIG_DIR.
// Usage differs per account, so it is tracked per config dir. This sentinel keys
// the default `~/.claude` account (config dir undefined).
const DEFAULT_ACCOUNT_KEY = "__default__"

// Per-account usage state. The store holds one of these per config dir.
interface AccountUsage {
  usageData: ClaudeUsageData | null
  lastFetchTime: number | null
  isLoading: boolean
}

class ClaudeUsageStore {
  // Keyed by config dir (DEFAULT_ACCOUNT_KEY for the default account). Kept per
  // account so two chats on different logins don't clobber each other's dials or
  // share the 15-minute rate-limit window.
  @observable
  private accounts = new Map<string, AccountUsage>()

  // Platform support is account-independent (the usage API is macOS-only), so it
  // stays a single flag rather than per-account state.
  @observable
  isSupported: boolean = true

  // Pending rate-limit-window rechecks, keyed the same as `accounts`.
  private scheduledChecks = new Map<string, ReturnType<typeof setTimeout>>()
  private unsubscribeFromEvents: (() => void) | null = null

  constructor() {
    makeObservable(this)

    // Subscribe to turn completion events and store unsubscribe function
    this.unsubscribeFromEvents = eventBus.on("agent:turnComplete", (payload) => {
      if (payload.agentType === "claude") {
        this.checkAndFetchUsage(payload.claudeConfigDir)
      }
    })
  }

  /**
   * Clean up resources when store is no longer needed
   */
  dispose() {
    // Unsubscribe from event bus
    if (this.unsubscribeFromEvents) {
      this.unsubscribeFromEvents()
      this.unsubscribeFromEvents = null
    }

    // Clear any pending timeouts
    for (const timeout of this.scheduledChecks.values()) {
      clearTimeout(timeout)
    }
    this.scheduledChecks.clear()
  }

  /** Usage for a given account (config dir), or null if not fetched yet. */
  getUsageData(configDir?: string): ClaudeUsageData | null {
    return this.accounts.get(accountKey(configDir))?.usageData ?? null
  }

  @action
  private checkAndFetchUsage(configDir?: string) {
    const now = Date.now()
    const lastFetchTime = this.accounts.get(accountKey(configDir))?.lastFetchTime ?? null

    // If we fetched this account recently, schedule for next window
    if (lastFetchTime && now - lastFetchTime < FETCH_INTERVAL_MS) {
      const timeUntilNextWindow = FETCH_INTERVAL_MS - (now - lastFetchTime)
      this.scheduleDelayedCheck(configDir, timeUntilNextWindow)
      return
    }

    // Otherwise fetch now
    void this.fetchUsage(configDir)
  }

  @action
  private scheduleDelayedCheck(configDir: string | undefined, delayMs: number) {
    const key = accountKey(configDir)

    // Clear any existing scheduled check for this account
    const existing = this.scheduledChecks.get(key)
    if (existing) clearTimeout(existing)

    // Schedule next check for this account
    this.scheduledChecks.set(
      key,
      setTimeout(() => {
        this.scheduledChecks.delete(key)
        void this.fetchUsage(configDir)
      }, delayMs)
    )
  }

  @action
  async fetchUsage(configDir?: string) {
    if (!this.isSupported) return
    const key = accountKey(configDir)
    if (this.accounts.get(key)?.isLoading) return

    this.patchAccount(key, { isLoading: true })
    try {
      const response = await backend.invoke<BackendClaudeUsageResponse>("fetch_claude_usage", {
        claudeConfigDir: configDir ?? null,
      })

      runInAction(() => {
        this.patchAccount(key, {
          usageData: mapUsageResponse(response),
          lastFetchTime: Date.now(),
          isLoading: false,
        })
      })
    } catch (error) {
      // If we get an unsupported platform error, disable future attempts
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (
        errorMsg.includes("only supported on macOS") ||
        errorMsg.includes("UnsupportedPlatform")
      ) {
        runInAction(() => {
          this.isSupported = false
        })
      } else {
        console.error("Failed to fetch Claude usage:", error)
      }
      runInAction(() => {
        this.patchAccount(key, { isLoading: false })
      })
    }
  }

  // Replace the account entry with a merged copy so the observable map reacts.
  @action
  private patchAccount(key: string, patch: Partial<AccountUsage>) {
    const current = this.accounts.get(key) ?? {
      usageData: null,
      lastFetchTime: null,
      isLoading: false,
    }
    this.accounts.set(key, { ...current, ...patch })
  }
}

function accountKey(configDir?: string): string {
  const trimmed = configDir?.trim()
  return trimmed ? trimmed : DEFAULT_ACCOUNT_KEY
}

function mapUsageResponse(response: BackendClaudeUsageResponse): ClaudeUsageData {
  const period = (p: BackendUsagePeriod | null): UsagePeriod | null =>
    p ? { utilization: p.utilization, resetsAt: p.resets_at } : null

  return {
    fiveHour: period(response.five_hour),
    sevenDay: period(response.seven_day),
    sevenDayOauthApps: period(response.seven_day_oauth_apps),
    sevenDayOpus: period(response.seven_day_opus),
    sevenDaySonnet: period(response.seven_day_sonnet),
    sevenDayCowork: period(response.seven_day_cowork),
    iguanaNecktie: period(response.iguana_necktie),
    extraUsage: response.extra_usage
      ? {
          isEnabled: response.extra_usage.is_enabled,
          monthlyLimit: response.extra_usage.monthly_limit,
          usedCredits: response.extra_usage.used_credits,
          utilization: response.extra_usage.utilization,
        }
      : null,
  }
}

export const claudeUsageStore = new ClaudeUsageStore()
