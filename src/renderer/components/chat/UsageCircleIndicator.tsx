import * as Tooltip from "@radix-ui/react-tooltip"

interface UsageCircleIndicatorProps {
  utilization: number
  label: string
  resetsAt: string | null
}

function getColor(utilization: number) {
  if (utilization >= 90) return "#ff4d6d"
  if (utilization >= 70) return "#ffee00"
  return "#2de2a6"
}

function formatResetTime(isoString: string | null) {
  if (!isoString) return "Unknown"

  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return "Unknown"

  const diffMs = date.getTime() - Date.now()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  if (diffHours > 0) {
    return `${diffHours}h ${diffMins}m`
  }
  return `${diffMins}m`
}

export function UsageCircleIndicator({ utilization, label, resetsAt }: UsageCircleIndicatorProps) {
  const size = 20
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (utilization / 100) * circumference

  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <svg
            width={size}
            height={size}
            className="transform -rotate-90"
            data-testid={`usage-indicator-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-ovr-border opacity-30"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={getColor(utilization)}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
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
