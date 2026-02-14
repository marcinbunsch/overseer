interface BetaBadgeProps {
  className?: string
}

export function BetaBadge({ className = "" }: BetaBadgeProps) {
  return (
    <span
      className={`rounded bg-ovr-warn/20 px-1 py-0.5 text-[10px] font-medium text-ovr-warn ${className}`}
    >
      BETA
    </span>
  )
}
