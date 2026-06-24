import { observer } from "mobx-react-lite"
import { useState, useRef, useEffect } from "react"
import { ChevronUp } from "lucide-react"

interface EffortLevel {
  value: string | null
  displayName: string
}

const EFFORT_LEVELS: EffortLevel[] = [
  { value: null, displayName: "Default" },
  { value: "low", displayName: "Low" },
  { value: "medium", displayName: "Medium" },
  { value: "high", displayName: "High" },
  { value: "max", displayName: "Max" },
]

interface EffortLevelSelectorProps {
  value: string | null
  onChange: (level: string | null) => void
  disabled?: boolean
}

export const EffortLevelSelector = observer(function EffortLevelSelector({
  value,
  onChange,
  disabled,
}: EffortLevelSelectorProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const displayLabel = EFFORT_LEVELS.find((l) => l.value === value)?.displayName ?? "Default"

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        title="Select effort level"
        data-testid="effort-level-selector"
      >
        <span>{displayLabel}</span>
        <ChevronUp size={12} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 min-w-28 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg"
          data-testid="effort-level-dropdown"
        >
          {EFFORT_LEVELS.map((l) => (
            <button
              key={l.value ?? "default"}
              onClick={() => {
                onChange(l.value)
                setOpen(false)
              }}
              className={`flex w-full items-center whitespace-nowrap px-3 py-1.5 text-xs hover:bg-ovr-bg-panel ${value === l.value ? "text-ovr-azure-400" : "text-ovr-text-primary"}`}
              data-testid={`effort-level-option-${l.value ?? "default"}`}
            >
              {l.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
