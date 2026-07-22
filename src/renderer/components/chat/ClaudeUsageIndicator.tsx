import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { claudeUsageStore } from "../../stores/ClaudeUsageStore"
import { configStore } from "../../stores/ConfigStore"
import { UsageCircleIndicator } from "./UsageCircleIndicator"

export const ClaudeUsageIndicator = observer(function ClaudeUsageIndicator() {
  const { usageData } = claudeUsageStore
  const { showClaudeUsageIndicator } = configStore

  useEffect(() => {
    if (showClaudeUsageIndicator) {
      void claudeUsageStore.fetchUsage()
    }
  }, [showClaudeUsageIndicator])

  if (!showClaudeUsageIndicator || !usageData) return null

  return (
    <div className="flex items-center gap-1.5" data-testid="claude-usage-indicator">
      {usageData.fiveHour && (
        <UsageCircleIndicator
          utilization={usageData.fiveHour.utilization}
          label="5-Hour Limit"
          resetsAt={usageData.fiveHour.resetsAt}
        />
      )}
      {usageData.sevenDay && (
        <UsageCircleIndicator
          utilization={usageData.sevenDay.utilization}
          label="7-Day Limit"
          resetsAt={usageData.sevenDay.resetsAt}
        />
      )}
    </div>
  )
})
