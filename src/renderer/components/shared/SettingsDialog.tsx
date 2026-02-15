import { observer } from "mobx-react-lite"
import { useState, useEffect } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import * as Select from "@radix-ui/react-select"
import * as Switch from "@radix-ui/react-switch"
import {
  X,
  Check,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Download,
  Settings2,
  Bot,
  Wrench,
  RefreshCw,
} from "lucide-react"
import cn from "classnames"
import { configStore } from "../../stores/ConfigStore"
import { debugStore } from "../../stores/DebugStore"
import { toolAvailabilityStore, type ToolStatus } from "../../stores/ToolAvailabilityStore"
import { updateStore } from "../../stores/UpdateStore"
import { getVersion } from "@tauri-apps/api/app"
import type { AgentType } from "../../types"
import { AgentIcon } from "../chat/AgentIcon"
import { ModelSelector } from "../chat/ModelSelector"
import { ClaudePermissionModeSelect } from "./ClaudePermissionModeSelect"

type SettingsTab = "general" | "agents" | "advanced" | "updates"

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings2 className="size-4" /> },
  { id: "agents", label: "Agents", icon: <Bot className="size-4" /> },
  { id: "advanced", label: "Advanced", icon: <Wrench className="size-4" /> },
  { id: "updates", label: "Updates", icon: <RefreshCw className="size-4" /> },
]

function StatusIcon({ status, isChecking }: { status: ToolStatus | null; isChecking: boolean }) {
  if (isChecking) {
    return <Loader2 className="size-4 animate-spin text-ovr-text-dim" />
  }
  if (status === null) {
    return null
  }
  if (status.available) {
    return (
      <span title={status.version || "Available"}>
        <Check className="size-4 text-ovr-ok" />
      </span>
    )
  }
  return (
    <span title={status.error || "Not available"}>
      <AlertTriangle className="size-4 text-ovr-warn" />
    </span>
  )
}

const AGENTS: { type: AgentType; label: string; description: string }[] = [
  { type: "claude", label: "Claude", description: "Anthropic's AI assistant" },
  { type: "codex", label: "Codex", description: "OpenAI's coding agent" },
  { type: "copilot", label: "Copilot", description: "GitHub's AI pair programmer" },
  { type: "gemini", label: "Gemini", description: "Google's AI model" },
  { type: "opencode", label: "OpenCode", description: "Open-source coding agent" },
]

// ============================================================================
// Tab Content Components
// ============================================================================

const GeneralTab = observer(function GeneralTab() {
  return (
    <div className="space-y-6">
      {/* Default Agent */}
      <div>
        <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Default agent</label>
        <Select.Root
          value={configStore.defaultAgent ?? "none"}
          onValueChange={(value) =>
            configStore.setDefaultAgent(value === "none" ? null : (value as AgentType))
          }
        >
          <Select.Trigger
            className="flex w-full max-w-xs cursor-pointer items-center justify-between rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2 text-xs text-ovr-text-primary focus:border-ovr-azure-500 focus:outline-none"
            data-testid="default-agent-trigger"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronDown className="size-3 text-ovr-text-dim" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              className="z-[100] overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-lg"
              position="popper"
              sideOffset={4}
            >
              <Select.Viewport className="p-1">
                <Select.Item
                  value="none"
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                >
                  <Select.ItemText>None</Select.ItemText>
                </Select.Item>
                {AGENTS.filter((a) => configStore.isAgentEnabled(a.type)).map((agent) => (
                  <Select.Item
                    key={agent.type}
                    value={agent.type}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ovr-text-primary outline-none data-[highlighted]:bg-ovr-bg-panel"
                  >
                    <AgentIcon agentType={agent.type} size={14} />
                    <Select.ItemText>{agent.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        <p className="mt-1.5 text-[11px] text-ovr-text-dim">
          {configStore.defaultAgent
            ? "New workspaces will start with this agent."
            : "New workspaces will show the agent selection screen."}
        </p>
      </div>

      {/* Animations */}
      <div>
        <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Appearance</label>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-ovr-text-primary">Animations</span>
            <p className="text-[11px] text-ovr-text-dim">Show spinning and loading animations</p>
          </div>
          <Switch.Root
            checked={configStore.animationsEnabled}
            onCheckedChange={(checked: boolean) => configStore.setAnimationsEnabled(checked)}
            className="relative h-5 w-9 cursor-pointer rounded-full bg-ovr-bg-elevated transition-colors data-[state=checked]:bg-ovr-azure-500"
            data-testid="animations-toggle"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
          </Switch.Root>
        </div>
      </div>
    </div>
  )
})

interface AgentSettingsProps {
  type: AgentType
  label: string
  cliPath: string
  status: ToolStatus | null
  isChecking: boolean
  onCheck: () => void
  defaultModel: string | null
  onModelChange: (model: string | null) => void
  extraSettings?: React.ReactNode
}

function AgentSettings({
  type,
  label,
  cliPath,
  status,
  isChecking,
  onCheck,
  defaultModel,
  onModelChange,
  extraSettings,
}: AgentSettingsProps) {
  return (
    <div className="rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-4">
      <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-primary">
        <AgentIcon agentType={type} size={16} />
        {label}
      </label>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-ovr-text-muted">CLI Path:</span>
          <code className="flex-1 truncate rounded bg-ovr-bg-panel px-2 py-1 text-xs text-ovr-text-primary">
            {cliPath}
          </code>
          <StatusIcon status={status} isChecking={isChecking} />
          <button
            onClick={onCheck}
            disabled={isChecking}
            className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
            data-testid={`check-${type}-btn`}
          >
            Check
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-ovr-text-muted">Default Model:</span>
          <ModelSelector value={defaultModel} onChange={onModelChange} agentType={type} />
        </div>
        {extraSettings}
      </div>
    </div>
  )
}

const AgentsTab = observer(function AgentsTab() {
  const [checkingClaude, setCheckingClaude] = useState(false)
  const [checkingCodex, setCheckingCodex] = useState(false)
  const [checkingCopilot, setCheckingCopilot] = useState(false)
  const [checkingGemini, setCheckingGemini] = useState(false)
  const [checkingOpencode, setCheckingOpencode] = useState(false)

  const handleCheckClaude = async () => {
    setCheckingClaude(true)
    try {
      await toolAvailabilityStore.recheckClaude()
    } finally {
      setCheckingClaude(false)
    }
  }

  const handleCheckCodex = async () => {
    setCheckingCodex(true)
    try {
      await toolAvailabilityStore.recheckCodex()
    } finally {
      setCheckingCodex(false)
    }
  }

  const handleCheckCopilot = async () => {
    setCheckingCopilot(true)
    try {
      await toolAvailabilityStore.recheckCopilot()
    } finally {
      setCheckingCopilot(false)
    }
  }

  const handleCheckGemini = async () => {
    setCheckingGemini(true)
    try {
      await toolAvailabilityStore.recheckGemini()
    } finally {
      setCheckingGemini(false)
    }
  }

  const handleCheckOpencode = async () => {
    setCheckingOpencode(true)
    try {
      await toolAvailabilityStore.recheckOpencode()
    } finally {
      setCheckingOpencode(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Enabled Agents */}
      <div>
        <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Enabled agents</label>
        <p className="mb-3 text-[11px] text-ovr-text-dim">
          Toggle which agents appear in the agent selection screen.
        </p>
        <div className="space-y-2">
          {AGENTS.map((agent) => {
            const isEnabled = configStore.isAgentEnabled(agent.type)
            return (
              <div
                key={agent.type}
                className="flex items-center justify-between rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <AgentIcon agentType={agent.type} size={16} />
                  <span className="text-xs text-ovr-text-primary">{agent.label}</span>
                  <span className="text-[11px] text-ovr-text-dim">- {agent.description}</span>
                </div>
                <Switch.Root
                  checked={isEnabled}
                  onCheckedChange={(checked: boolean) =>
                    configStore.setAgentEnabled(agent.type, checked)
                  }
                  className="relative h-5 w-9 cursor-pointer rounded-full bg-ovr-bg-panel transition-colors data-[state=checked]:bg-ovr-azure-500"
                  data-testid={`agent-toggle-${agent.type}`}
                >
                  <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
                </Switch.Root>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-Agent Settings */}
      <div>
        <label className="mb-3 block text-xs font-medium text-ovr-text-muted">Agent settings</label>
        <div className="space-y-3">
          {configStore.isAgentEnabled("claude") && (
            <AgentSettings
              type="claude"
              label="Claude"
              cliPath={configStore.claudePath}
              status={toolAvailabilityStore.claude}
              isChecking={checkingClaude}
              onCheck={handleCheckClaude}
              defaultModel={configStore.defaultClaudeModel}
              onModelChange={(model) => configStore.setDefaultClaudeModel(model)}
              extraSettings={
                <div className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-ovr-text-muted">
                    Permission Mode:
                  </span>
                  <ClaudePermissionModeSelect />
                </div>
              }
            />
          )}

          {configStore.isAgentEnabled("codex") && (
            <AgentSettings
              type="codex"
              label="Codex"
              cliPath={configStore.codexPath}
              status={toolAvailabilityStore.codex}
              isChecking={checkingCodex}
              onCheck={handleCheckCodex}
              defaultModel={configStore.defaultCodexModel}
              onModelChange={(model) => configStore.setDefaultCodexModel(model)}
            />
          )}

          {configStore.isAgentEnabled("copilot") && (
            <AgentSettings
              type="copilot"
              label="Copilot"
              cliPath={configStore.copilotPath}
              status={toolAvailabilityStore.copilot}
              isChecking={checkingCopilot}
              onCheck={handleCheckCopilot}
              defaultModel={configStore.defaultCopilotModel}
              onModelChange={(model) => configStore.setDefaultCopilotModel(model)}
            />
          )}

          {configStore.isAgentEnabled("gemini") && (
            <AgentSettings
              type="gemini"
              label="Gemini"
              cliPath={configStore.geminiPath}
              status={toolAvailabilityStore.gemini}
              isChecking={checkingGemini}
              onCheck={handleCheckGemini}
              defaultModel={configStore.defaultGeminiModel}
              onModelChange={(model) => configStore.setDefaultGeminiModel(model)}
            />
          )}

          {configStore.isAgentEnabled("opencode") && (
            <AgentSettings
              type="opencode"
              label="OpenCode"
              cliPath={configStore.opencodePath}
              status={toolAvailabilityStore.opencode}
              isChecking={checkingOpencode}
              onCheck={handleCheckOpencode}
              defaultModel={configStore.defaultOpencodeModel}
              onModelChange={(model) => configStore.setDefaultOpencodeModel(model)}
            />
          )}

          {configStore.enabledAgents.length === 0 && (
            <p className="text-xs text-ovr-text-dim">
              No agents enabled. Enable agents above to configure them.
            </p>
          )}
        </div>
      </div>
    </div>
  )
})

const AdvancedTab = observer(function AdvancedTab() {
  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Shell Prefix</label>
        <input
          type="text"
          value={configStore.agentShell}
          onChange={(e) => configStore.setAgentShell(e.target.value)}
          placeholder="$SHELL -l -c"
          className="ovr-input w-full max-w-md px-3 py-2 text-xs"
          data-testid="agent-shell-input"
        />
        <p className="mt-2 text-[11px] text-ovr-text-dim">
          Shell prefix for launching agents. Default: $SHELL -l -c (login shell).
          <br />
          Examples: /bin/bash -l -c, /bin/zsh -c
        </p>
      </div>
    </div>
  )
})

const UpdatesTab = observer(function UpdatesTab() {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then(setCurrentVersion)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-ovr-text-primary">
            Current version: {currentVersion ?? "..."}
          </span>
        </div>
        <button
          onClick={() => updateStore.checkForUpdates(false)}
          disabled={updateStore.isChecking}
          className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
          data-testid="check-updates-btn"
        >
          {updateStore.isChecking ? (
            <span className="flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Checking...
            </span>
          ) : (
            "Check for updates"
          )}
        </button>
      </div>

      {updateStore.availableUpdate && (
        <div className="rounded-lg border border-ovr-azure-500/30 bg-ovr-azure-500/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-ovr-text-primary">
                v{updateStore.availableUpdate.version} available
              </span>
              {updateStore.availableUpdate.body && (
                <p className="mt-1 line-clamp-3 text-[11px] text-ovr-text-dim">
                  {updateStore.availableUpdate.body}
                </p>
              )}
            </div>
            <button
              onClick={() => updateStore.downloadAndInstall()}
              disabled={updateStore.isDownloading}
              className="ovr-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              data-testid="install-update-btn"
            >
              {updateStore.isDownloading ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  Install & Restart
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {updateStore.error && <p className="text-[11px] text-ovr-error">{updateStore.error}</p>}

      {!updateStore.availableUpdate && !updateStore.isChecking && !updateStore.error && (
        <p className="text-[11px] text-ovr-text-dim">You're on the latest version.</p>
      )}

      {debugStore.showDevUI && (
        <button
          onClick={() => updateStore.simulateFakeUpdate()}
          className="rounded border border-dashed border-ovr-warn px-2 py-1 text-[10px] text-ovr-warn hover:bg-ovr-warn/10"
        >
          [DEV] Simulate fake update
        </button>
      )}
    </div>
  )
})

// ============================================================================
// Main Dialog Component
// ============================================================================

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const SettingsDialog = observer(function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general")

  // Lazy-load OpenCode models when settings dialog opens
  useEffect(() => {
    if (open && configStore.isAgentEnabled("opencode")) {
      configStore.refreshOpencodeModels()
    }
  }, [open])

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] max-h-[700px] w-[90vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel shadow-ovr-panel">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-ovr-border-subtle px-4 py-3">
            <AlertDialog.Title className="flex items-center gap-2 text-sm font-semibold text-ovr-text-strong">
              Settings
              {updateStore.availableUpdate && (
                <span className="size-2 rounded-full bg-ovr-azure-500" title="Update available" />
              )}
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                <X className="size-4" />
              </button>
            </AlertDialog.Cancel>
          </div>

          {/* Body - Sidebar + Content */}
          <div className="flex min-h-0 flex-1">
            {/* Sidebar */}
            <nav className="w-44 shrink-0 border-r border-ovr-border-subtle bg-ovr-bg-panel p-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`tab-${tab.id}`}
                  className={classNames(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    {
                      "bg-ovr-bg-elevated text-ovr-text-strong": activeTab === tab.id,
                      "text-ovr-text-primary hover:bg-ovr-bg-elevated/50": activeTab !== tab.id,
                    }
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.id === "updates" && updateStore.availableUpdate && (
                    <span className="ml-auto size-2 rounded-full bg-ovr-azure-500" />
                  )}
                </button>
              ))}
            </nav>

            {/* Content - render all tabs, hide inactive ones to preserve state */}
            <div className="flex-1 overflow-y-auto bg-ovr-bg-app px-6 py-4">
              <div className={activeTab === "general" ? "" : "hidden"}>
                <GeneralTab />
              </div>
              <div className={activeTab === "agents" ? "" : "hidden"}>
                <AgentsTab />
              </div>
              <div className={activeTab === "advanced" ? "" : "hidden"}>
                <AdvancedTab />
              </div>
              <div className={activeTab === "updates" ? "" : "hidden"}>
                <UpdatesTab />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex shrink-0 justify-end border-t border-ovr-border-subtle px-4 py-3">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Done</button>
            </AlertDialog.Cancel>
          </div>

          <AlertDialog.Description className="sr-only">
            Application settings
          </AlertDialog.Description>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
