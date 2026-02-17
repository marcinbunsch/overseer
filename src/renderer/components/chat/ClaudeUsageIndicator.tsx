import { observer } from "mobx-react-lite"
import * as Tooltip from "@radix-ui/react-tooltip"
import { claudeUsageStore } from "../../stores/ClaudeUsageStore"

interface CircleIndicatorProps {
  utilization: number
  label: string
  resetsAt: string
}

function CircleIndicator({ utilization, label, resetsAt }: CircleIndicatorProps) {
  const getColor = (util: number) => {
    if (util >= 90) return "bg-red-500"
    if (util >= 70) return "bg-yellow-500"
    return "bg-green-500"
  }

  const formatResetTime = (isoString: string) => {
    try {
      const date = new Date(isoString)
      const now = new Date()
      const diffMs = date.getTime() - now.getTime()
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

      if (diffHours > 0) {
        return `${diffHours}h ${diffMins}m`
      }
      return `${diffMins}m`
    } catch {
      return "Unknown"
    }
  }

  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className={`h-2 w-2 rounded-full ${getColor(utilization)}`}
            data-testid={`usage-indicator-${label.toLowerCase().replace(/\s+/g, "-")}`}
          />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 rounded bg-ovr-bg-elevated px-3 py-2 text-xs text-ovr-text-primary shadow-lg"
            sideOffset={5}
          >
            <div className="font-medium">{label}</div>
            <div className="text-ovr-text-muted">
              {utilization.toFixed(0)}% used
              <br />
              Resets in {formatResetTime(resetsAt)}
            </div>
            <Tooltip.Arrow className="fill-ovr-bg-elevated" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export const ClaudeUsageIndicator = observer(function ClaudeUsageIndicator() {
  const { usageData } = claudeUsageStore

  if (!usageData) return null

  return (
    <div className="flex items-center gap-1.5" data-testid="claude-usage-indicator">
      {usageData.fiveHour && (
        <CircleIndicator
          utilization={usageData.fiveHour.utilization}
          label="5-Hour Limit"
          resetsAt={usageData.fiveHour.resetsAt}
        />
      )}
      {usageData.sevenDay && (
        <CircleIndicator
          utilization={usageData.sevenDay.utilization}
          label="7-Day Limit"
          resetsAt={usageData.sevenDay.resetsAt}
        />
      )}
    </div>
  )
})
