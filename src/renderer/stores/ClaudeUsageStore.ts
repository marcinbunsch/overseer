import { observable, action, runInAction, makeObservable } from "mobx"
import { backend } from "../backend"
import { eventBus } from "../utils/eventBus"

export interface UsagePeriod {
  utilization: number
  resetsAt: string
}

export interface ExtraUsage {
  isEnabled: boolean
  monthlyLimit: number
  usedCredits: number
  utilization: number
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
  monthly_limit: number
  used_credits: number
  utilization: number
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

class ClaudeUsageStore {
  @observable
  usageData: ClaudeUsageData | null = null

  @observable
  lastFetchTime: number | null = null

  @observable
  isLoading: boolean = false

  @observable
  isSupported: boolean = true

  private scheduledCheckTimeout: ReturnType<typeof setTimeout> | null = null
  private unsubscribeFromEvents: (() => void) | null = null

  constructor() {
    makeObservable(this)

    // Subscribe to turn completion events and store unsubscribe function
    this.unsubscribeFromEvents = eventBus.on("agent:turnComplete", (payload) => {
      if (payload.agentType === "claude") {
        this.checkAndFetchUsage()
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

    // Clear any pending timeout
    if (this.scheduledCheckTimeout) {
      clearTimeout(this.scheduledCheckTimeout)
      this.scheduledCheckTimeout = null
    }
  }

  @action
  private checkAndFetchUsage() {
    const now = Date.now()

    // If we fetched recently, schedule for next window
    if (this.lastFetchTime && now - this.lastFetchTime < FETCH_INTERVAL_MS) {
      const timeUntilNextWindow = FETCH_INTERVAL_MS - (now - this.lastFetchTime)
      this.scheduleDelayedCheck(timeUntilNextWindow)
      return
    }

    // Otherwise fetch now
    void this.fetchUsage()
  }

  @action
  private scheduleDelayedCheck(delayMs: number) {
    // Clear any existing scheduled check
    if (this.scheduledCheckTimeout) {
      clearTimeout(this.scheduledCheckTimeout)
    }

    // Schedule next check
    this.scheduledCheckTimeout = setTimeout(() => {
      this.scheduledCheckTimeout = null
      void this.fetchUsage()
    }, delayMs)
  }

  @action
  async fetchUsage() {
    if (this.isLoading || !this.isSupported) return

    this.isLoading = true
    try {
      const response = await backend.invoke<BackendClaudeUsageResponse>("fetch_claude_usage")

      runInAction(() => {
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
    } finally {
      runInAction(() => {
        this.isLoading = false
      })
    }
  }
}

export const claudeUsageStore = new ClaudeUsageStore()
