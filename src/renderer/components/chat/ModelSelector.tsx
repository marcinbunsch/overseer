import { observer } from "mobx-react-lite"
import { useState, useRef, useEffect } from "react"
import { ChevronUp } from "lucide-react"
import { configStore } from "../../stores/ConfigStore"

interface ModelSelectorProps {
  value: string | null
  onChange: (model: string | null) => void
  disabled?: boolean
  agentType?: string
}

export const ModelSelector = observer(function ModelSelector({
  value,
  onChange,
  disabled,
  agentType = "claude",
}: ModelSelectorProps) {
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

  // Lazy-load OpenCode models on mount when selector is enabled
  useEffect(() => {
    if (!disabled && agentType === "opencode") {
      configStore.refreshOpencodeModels()
    }
  }, [disabled, agentType])

  const models = (() => {
    switch (agentType) {
      case "codex":
        return configStore.codexModels
      case "copilot":
        return configStore.copilotModels
      case "gemini":
        return configStore.geminiModels
      case "opencode":
        return configStore.opencodeModels
      default:
        return configStore.claudeModels
    }
  })()

  const displayLabel = value
    ? (models.find((m) => m.alias === value)?.displayName ?? value)
    : "Default"

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        title="Select model"
        data-testid="model-selector"
      >
        <span>{displayLabel}</span>
        <ChevronUp size={12} className={`transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 min-w-35 max-h-80 overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated py-1 shadow-lg"
          data-testid="model-dropdown"
        >
          <button
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={`flex w-full items-center whitespace-nowrap px-3 py-1.5 text-xs hover:bg-ovr-bg-panel ${!value ? "text-ovr-azure-400" : "text-ovr-text-primary"}`}
            data-testid="model-option-default"
          >
            Default
          </button>

          {models.map((m) => (
            <button
              key={m.alias}
              onClick={() => {
                onChange(m.alias)
                setOpen(false)
              }}
              className={`flex w-full items-center whitespace-nowrap px-3 py-1.5 text-xs hover:bg-ovr-bg-panel ${value === m.alias ? "text-ovr-azure-400" : "text-ovr-text-primary"}`}
              data-testid={`model-option-${m.alias}`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
