import { observer } from "mobx-react-lite"
import { codexUsageStore, type CodexUsageWindow } from "../../stores/CodexUsageStore"
import { UsageCircleIndicator } from "./UsageCircleIndicator"

function formatWindowLabel(name: "Primary" | "Secondary", window: CodexUsageWindow): string {
  if (!window.windowDurationMins) return `${name} Limit`

  if (window.windowDurationMins % 60 === 0) {
    return `${name} ${window.windowDurationMins / 60}-Hour Limit`
  }

  return `${name} ${window.windowDurationMins}-Minute Limit`
}

function formatResetTime(resetsAt: number | null): string | null {
  return resetsAt === null ? null : new Date(resetsAt * 1000).toISOString()
}

function formatPlan(planType: string): string {
  return planType
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ")
}

export const CodexUsageIndicator = observer(function CodexUsageIndicator() {
  const { usageData } = codexUsageStore

  if (!usageData) return null

  const credits = usageData.credits
  const accountDetails = [
    usageData.planType && formatPlan(usageData.planType),
    credits?.unlimited ? "Unlimited credits" : credits?.balance && `Credits: ${credits.balance}`,
  ].filter((detail): detail is string => Boolean(detail))

  return (
    <div className="flex items-center gap-1.5" data-testid="codex-usage-indicator">
      {usageData.primary && (
        <UsageCircleIndicator
          utilization={usageData.primary.usedPercent}
          label={formatWindowLabel("Primary", usageData.primary)}
          resetsAt={formatResetTime(usageData.primary.resetsAt)}
        />
      )}
      {usageData.secondary && (
        <UsageCircleIndicator
          utilization={usageData.secondary.usedPercent}
          label={formatWindowLabel("Secondary", usageData.secondary)}
          resetsAt={formatResetTime(usageData.secondary.resetsAt)}
        />
      )}
      {accountDetails.length > 0 && (
        <span className="text-[11px] text-ovr-text-muted" data-testid="codex-usage-account-details">
          {accountDetails.join(" · ")}
        </span>
      )}
    </div>
  )
})
