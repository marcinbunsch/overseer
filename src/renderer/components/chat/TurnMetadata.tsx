import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { TurnMetadata as TurnMetadataData } from "../../services/types"

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

interface TurnMetadataProps {
  metadata: TurnMetadataData
  copyButton?: ReactNode
}

export function TurnMetadata({ metadata, copyButton }: TurnMetadataProps) {
  const [expanded, setExpanded] = useState(false)
  const usage = [
    metadata.inputTokens === undefined ? null : `Input ${formatNumber(metadata.inputTokens)}`,
    metadata.cacheReadTokens === undefined
      ? null
      : `Cache read ${formatNumber(metadata.cacheReadTokens)}`,
    metadata.cacheWriteTokens === undefined
      ? null
      : `Cache write ${formatNumber(metadata.cacheWriteTokens)}`,
    metadata.outputTokens === undefined ? null : `Output ${formatNumber(metadata.outputTokens)}`,
    metadata.reasoningOutputTokens === undefined
      ? null
      : `Reasoning ${formatNumber(metadata.reasoningOutputTokens)}`,
  ].filter((value): value is string => value !== null)

  return (
    <div className="mb-4 ml-1 mt-1 text-xs text-ovr-text-muted" data-testid="turn-metadata">
      <div className="flex items-center gap-1">
        {usage.length > 0 && (
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Hide token details" : "Show token details"}
            className="rounded p-0.5 hover:bg-ovr-bg-panel hover:text-ovr-text-primary"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <span>{formatTime(metadata.completedAt)}</span>
        {copyButton}
        {metadata.costUsd === undefined ? "" : ` · ${formatCost(metadata.costUsd)}`}
        {metadata.totalTokens === undefined
          ? ""
          : ` · ${formatNumber(metadata.totalTokens)} tokens`}
        {metadata.durationMs === undefined ? "" : ` · ${(metadata.durationMs / 1000).toFixed(1)}s`}
      </div>
      {expanded && usage.length > 0 && <div className="mt-1">{usage.join(" · ")}</div>}
    </div>
  )
}
