import { observer } from "mobx-react-lite"
import { useState, useRef, useEffect } from "react"
import { ChevronUp } from "lucide-react"

interface PermissionMode {
  value: string | null
  displayName: string
}

const PERMISSION_MODES: PermissionMode[] = [
  { value: null, displayName: "Default" },
  { value: "acceptEdits", displayName: "Accept Edits" },
  { value: "bypassPermissions", displayName: "Yolo Mode" },
]

interface ClaudePermissionModeSelectorProps {
  value: string | null
  onChange: (mode: string | null) => void
  disabled?: boolean
}

export const ClaudePermissionModeSelector = observer(function ClaudePermissionModeSelector({
  value,
  onChange,
  disabled,
}: ClaudePermissionModeSelectorProps) {
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

  const displayLabel = PERMISSION_MODES.find((m) => m.value === value)?.displayName ?? "Default"

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        title="Select permission mode"
        data-testid="permission-mode-selector"
      >
        <span>{displayLabel}</span>
        <ChevronUp size={12} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 min-w-35 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg"
          data-testid="permission-mode-dropdown"
        >
          {PERMISSION_MODES.map((m) => (
            <button
              key={m.value ?? "default"}
              onClick={() => {
                onChange(m.value)
                setOpen(false)
              }}
              className={`flex w-full items-center whitespace-nowrap px-3 py-1.5 text-xs hover:bg-ovr-bg-panel ${value === m.value ? "text-ovr-azure-400" : "text-ovr-text-primary"}`}
              data-testid={`permission-mode-option-${m.value ?? "default"}`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
