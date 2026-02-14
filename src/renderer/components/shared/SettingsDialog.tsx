import { observer } from "mobx-react-lite"
import { useState, useEffect } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import * as Select from "@radix-ui/react-select"
import * as Switch from "@radix-ui/react-switch"
import { X, Check, AlertTriangle, Loader2, ChevronDown, Download } from "lucide-react"
import { configStore } from "../../stores/ConfigStore"
import { debugStore } from "../../stores/DebugStore"
import { toolAvailabilityStore, type ToolStatus } from "../../stores/ToolAvailabilityStore"
import { updateStore } from "../../stores/UpdateStore"
import { getVersion } from "@tauri-apps/api/app"
import type { AgentType } from "../../types"
import { AgentIcon } from "../chat/AgentIcon"
import { ModelSelector } from "../chat/ModelSelector"
import { ClaudePermissionModeSelect } from "./ClaudePermissionModeSelect"

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

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const SettingsDialog = observer(function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const [checkingClaude, setCheckingClaude] = useState(false)
  const [checkingCodex, setCheckingCodex] = useState(false)
  const [checkingCopilot, setCheckingCopilot] = useState(false)
  const [checkingGemini, setCheckingGemini] = useState(false)
  const [checkingOpencode, setCheckingOpencode] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  // Get current version on mount
  useEffect(() => {
    getVersion().then(setCurrentVersion)
  }, [])

  // Lazy-load OpenCode models when settings dialog opens
  useEffect(() => {
    if (open && configStore.isAgentEnabled("opencode")) {
      configStore.refreshOpencodeModels()
    }
  }, [open])

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
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-105 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <div className="flex items-center justify-between">
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

          <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-2">
            {/* Default Agent */}
            <div>
              <label className="mb-2 block text-xs font-medium text-ovr-text-muted">
                Default agent
              </label>
              <Select.Root
                value={configStore.defaultAgent ?? "none"}
                onValueChange={(value) =>
                  configStore.setDefaultAgent(value === "none" ? null : (value as AgentType))
                }
              >
                <Select.Trigger className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2 text-xs text-ovr-text-primary focus:border-ovr-azure-500 focus:outline-none">
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

            {/* Enabled Agents */}
            <div className="border-t border-ovr-border-subtle pt-4">
              <label className="mb-2 block text-xs font-medium text-ovr-text-muted">
                Enabled agents
              </label>
              <p className="mb-3 text-[11px] text-ovr-text-dim">
                Toggle which agents appear in the agent selection screen.
              </p>
              <div className="space-y-3">
                {AGENTS.map((agent) => {
                  const isEnabled = configStore.isAgentEnabled(agent.type)
                  return (
                    <div key={agent.type} className="flex items-center justify-between">
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
                        className="relative h-5 w-9 cursor-pointer rounded-full bg-ovr-bg-elevated transition-colors data-[state=checked]:bg-ovr-azure-500"
                      >
                        <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-4" />
                      </Switch.Root>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Claude Settings */}
            {configStore.isAgentEnabled("claude") && (
              <div className="border-t border-ovr-border-subtle pt-4">
                <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-muted">
                  <AgentIcon agentType="claude" size={14} />
                  Claude
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">CLI Path:</span>
                    <code className="flex-1 truncate rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary">
                      {configStore.claudePath}
                    </code>
                    <StatusIcon status={toolAvailabilityStore.claude} isChecking={checkingClaude} />
                    <button
                      onClick={handleCheckClaude}
                      disabled={checkingClaude}
                      className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
                      data-testid="check-claude-btn"
                    >
                      Check
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Default Model:</span>
                    <ModelSelector
                      value={configStore.defaultClaudeModel}
                      onChange={(model) => configStore.setDefaultClaudeModel(model)}
                      agentType="claude"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Permission Mode:</span>
                    <ClaudePermissionModeSelect />
                  </div>
                </div>
              </div>
            )}

            {/* Codex Settings */}
            {configStore.isAgentEnabled("codex") && (
              <div className="border-t border-ovr-border-subtle pt-4">
                <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-muted">
                  <AgentIcon agentType="codex" size={14} />
                  Codex
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">CLI Path:</span>
                    <code className="flex-1 truncate rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary">
                      {configStore.codexPath}
                    </code>
                    <StatusIcon status={toolAvailabilityStore.codex} isChecking={checkingCodex} />
                    <button
                      onClick={handleCheckCodex}
                      disabled={checkingCodex}
                      className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
                      data-testid="check-codex-btn"
                    >
                      Check
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Default Model:</span>
                    <ModelSelector
                      value={configStore.defaultCodexModel}
                      onChange={(model) => configStore.setDefaultCodexModel(model)}
                      agentType="codex"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Copilot Settings */}
            {configStore.isAgentEnabled("copilot") && (
              <div className="border-t border-ovr-border-subtle pt-4">
                <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-muted">
                  <AgentIcon agentType="copilot" size={14} />
                  Copilot
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">CLI Path:</span>
                    <code className="flex-1 truncate rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary">
                      {configStore.copilotPath}
                    </code>
                    <StatusIcon
                      status={toolAvailabilityStore.copilot}
                      isChecking={checkingCopilot}
                    />
                    <button
                      onClick={handleCheckCopilot}
                      disabled={checkingCopilot}
                      className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
                      data-testid="check-copilot-btn"
                    >
                      Check
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Default Model:</span>
                    <ModelSelector
                      value={configStore.defaultCopilotModel}
                      onChange={(model) => configStore.setDefaultCopilotModel(model)}
                      agentType="copilot"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Gemini Settings */}
            {configStore.isAgentEnabled("gemini") && (
              <div className="border-t border-ovr-border-subtle pt-4">
                <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-muted">
                  <AgentIcon agentType="gemini" size={14} />
                  Gemini
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">CLI Path:</span>
                    <code className="flex-1 truncate rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary">
                      {configStore.geminiPath}
                    </code>
                    <StatusIcon status={toolAvailabilityStore.gemini} isChecking={checkingGemini} />
                    <button
                      onClick={handleCheckGemini}
                      disabled={checkingGemini}
                      className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
                      data-testid="check-gemini-btn"
                    >
                      Check
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Default Model:</span>
                    <ModelSelector
                      value={configStore.defaultGeminiModel}
                      onChange={(model) => configStore.setDefaultGeminiModel(model)}
                      agentType="gemini"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OpenCode Settings */}
            {configStore.isAgentEnabled("opencode") && (
              <div className="border-t border-ovr-border-subtle pt-4">
                <label className="mb-3 flex items-center gap-2 text-xs font-medium text-ovr-text-muted">
                  <AgentIcon agentType="opencode" size={14} />
                  OpenCode
                </label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">CLI Path:</span>
                    <code className="flex-1 truncate rounded bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary">
                      {configStore.opencodePath}
                    </code>
                    <StatusIcon
                      status={toolAvailabilityStore.opencode}
                      isChecking={checkingOpencode}
                    />
                    <button
                      onClick={handleCheckOpencode}
                      disabled={checkingOpencode}
                      className="rounded px-2 py-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary disabled:opacity-50"
                      data-testid="check-opencode-btn"
                    >
                      Check
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Default Model:</span>
                    <ModelSelector
                      value={configStore.defaultOpencodeModel}
                      onChange={(model) => configStore.setDefaultOpencodeModel(model)}
                      agentType="opencode"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Appearance */}
            <div className="border-t border-ovr-border-subtle pt-4">
              <label className="mb-2 block text-xs font-medium text-ovr-text-muted">
                Appearance
              </label>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-ovr-text-primary">Animations</span>
                  <p className="text-[11px] text-ovr-text-dim">
                    Show spinning and loading animations
                  </p>
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

            {/* Advanced */}
            <div className="border-t border-ovr-border-subtle pt-4">
              <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Advanced</label>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-28 text-xs text-ovr-text-muted">Shell Prefix:</span>
                    <input
                      type="text"
                      value={configStore.agentShell}
                      onChange={(e) => configStore.setAgentShell(e.target.value)}
                      placeholder="$SHELL -l -c"
                      className="ovr-input flex-1 px-2 py-1 text-xs"
                      data-testid="agent-shell-input"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ovr-text-dim">
                    Shell prefix for launching agents. Default: $SHELL -l -c (login shell).
                    Examples: /bin/bash -l -c, /bin/zsh -c
                  </p>
                </div>
              </div>
            </div>

            {/* Updates */}
            <div className="border-t border-ovr-border-subtle pt-4">
              <label className="mb-2 block text-xs font-medium text-ovr-text-muted">Updates</label>
              <div className="space-y-3">
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
                  <div className="rounded-lg border border-ovr-azure-500/30 bg-ovr-azure-500/10 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-ovr-text-primary">
                          v{updateStore.availableUpdate.version} available
                        </span>
                        {updateStore.availableUpdate.body && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-ovr-text-dim">
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

                {updateStore.error && (
                  <p className="text-[11px] text-ovr-error">{updateStore.error}</p>
                )}

                {!updateStore.availableUpdate && !updateStore.isChecking && !updateStore.error && (
                  <p className="text-[11px] text-ovr-text-dim">You're on the latest version.</p>
                )}

                {debugStore.showDevUI && (
                  <button
                    onClick={() => updateStore.simulateFakeUpdate()}
                    className="mt-2 rounded border border-dashed border-ovr-warn px-2 py-1 text-[10px] text-ovr-warn hover:bg-ovr-warn/10"
                  >
                    [DEV] Simulate fake update
                  </button>
                )}
              </div>
            </div>
          </div>

          <AlertDialog.Description className="sr-only">
            Application settings
          </AlertDialog.Description>

          <div className="mt-5 flex justify-end">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Done</button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
