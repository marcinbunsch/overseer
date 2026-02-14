import { observer } from "mobx-react-lite"
import * as Select from "@radix-ui/react-select"
import { ChevronDown } from "lucide-react"
import { configStore, type ClaudePermissionMode } from "../../stores/ConfigStore"

const PERMISSION_MODES: { value: ClaudePermissionMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "bypassPermissions", label: "Yolo Mode" },
]

export const ClaudePermissionModeSelect = observer(function ClaudePermissionModeSelect() {
  return (
    <Select.Root
      value={configStore.claudePermissionMode}
      onValueChange={(value) => configStore.setClaudePermissionMode(value as ClaudePermissionMode)}
    >
      <Select.Trigger className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-ovr-text-muted hover:bg-ovr-bg-elevated hover:text-ovr-text-primary focus:outline-none">
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="size-3" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="z-[100] overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {PERMISSION_MODES.map((mode) => (
              <Select.Item
                key={mode.value}
                value={mode.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel data-[state=checked]:text-ovr-azure-400"
              >
                <Select.ItemText>{mode.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
})
