import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { claudeUsageStore } from "../../stores/ClaudeUsageStore"
import { configStore } from "../../stores/ConfigStore"
import { UsageCircleIndicator } from "./UsageCircleIndicator"

interface ClaudeUsageIndicatorProps {
  // The chat's per-project CLAUDE_CONFIG_DIR override, selecting which account's
  // usage to show. Undefined = the default `~/.claude` account.
  claudeConfigDir?: string
}

export const ClaudeUsageIndicator = observer(function ClaudeUsageIndicator({
  claudeConfigDir,
}: ClaudeUsageIndicatorProps) {
  const { showClaudeUsageIndicator } = configStore
  const usageData = claudeUsageStore.getUsageData(claudeConfigDir)

  useEffect(() => {
    if (showClaudeUsageIndicator) {
      void claudeUsageStore.fetchUsage(claudeConfigDir)
    }
  }, [showClaudeUsageIndicator, claudeConfigDir])

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
