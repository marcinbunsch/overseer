import { observable, action, makeObservable, runInAction } from "mobx"
import { z } from "zod"
import type { AgentModel, AgentType } from "../types"
import { listOpencodeModels } from "../services/opencode"
import { listPiModels } from "../services/pi"
import { backend } from "../backend"
import { remoteServerStore, type RemoteServerConfig } from "./RemoteServerStore"

export type ClaudePermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions"
export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never"
export type GeminiApprovalMode = "yolo" | "auto_edit"

interface HttpServerConfig {
  host: string
  port: number
  enableAuth: boolean
  autoStart: boolean
}

interface Config {
  claudePath: string
  codexPath: string
  copilotPath: string
  geminiPath: string
  opencodePath: string
  piPath: string
  agentShell?: string
  leftPaneWidth: number
  rightPaneWidth: number
  changesHeight: number
  rightPaneTab: "changes" | "commits"
  editorCommand: string
  terminalCommand: string
  enabledAgents?: AgentType[]
  defaultAgent: AgentType | null
  defaultClaudeModel?: string | null
  defaultCodexModel?: string | null
  defaultCopilotModel?: string | null
  defaultGeminiModel?: string | null
  defaultOpencodeModel?: string | null
  defaultPiModel?: string | null
  claudePermissionMode?: ClaudePermissionMode
  codexApprovalPolicy?: CodexApprovalPolicy
  geminiApprovalMode?: GeminiApprovalMode
  animationsEnabled?: boolean
  showClaudeUsageIndicator?: boolean
  autonomousModeEnabled?: boolean
  remoteModelsEnabled?: boolean
  terminalOpenByDefault?: boolean
  soundNotificationEnabled?: boolean
  systemNotificationEnabled?: boolean
  showReviewPrs?: boolean
  httpServer?: HttpServerConfig
  remoteServers?: RemoteServerConfig[]
}

const ALL_AGENTS: AgentType[] = ["claude", "codex", "copilot", "gemini", "opencode", "pi"]

const DEFAULT_CONFIG: Config = {
  claudePath: "$HOME/.local/bin/claude",
  codexPath: "codex",
  copilotPath: "copilot",
  geminiPath: "gemini",
  opencodePath: "opencode",
  piPath: "pi",
  leftPaneWidth: 250,
  rightPaneWidth: 300,
  changesHeight: 250,
  rightPaneTab: "changes" as const,
  editorCommand: "code",
  terminalCommand: "open -a iTerm",
  enabledAgents: ALL_AGENTS,
  defaultAgent: "claude",
}

const CODEX_APPROVAL_POLICIES: CodexApprovalPolicy[] = [
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]

const normalizeCodexApprovalPolicy = (value: unknown): CodexApprovalPolicy => {
  if (value === "full-auto") return "never"
  if (CODEX_APPROVAL_POLICIES.includes(value as CodexApprovalPolicy)) {
    return value as CodexApprovalPolicy
  }
  return "untrusted"
}

const FALLBACK_CLAUDE_PATH = "claude"
const FALLBACK_CODEX_PATH = "codex"
const FALLBACK_COPILOT_PATH = "copilot"
const FALLBACK_GEMINI_PATH = "gemini"
const FALLBACK_OPENCODE_PATH = "opencode"
const FALLBACK_PI_PATH = "pi"

const AgentModelSchema = z.object({
  alias: z.string().min(1),
  displayName: z.string().min(1),
})

const RemoteModelsSchema = z.object({
  claude: z.array(AgentModelSchema).optional(),
  codex: z.array(AgentModelSchema).optional(),
  copilot: z.array(AgentModelSchema).optional(),
  gemini: z.array(AgentModelSchema).optional(),
  opencode: z.array(AgentModelSchema).optional(),
})

export const DEFAULT_CLAUDE_MODELS: AgentModel[] = [
  { alias: "claude-fable-5", displayName: "Fable 5" },
  { alias: "claude-opus-5", displayName: "Opus 5" },
  { alias: "claude-sonnet-5", displayName: "Sonnet 5" },
  { alias: "claude-opus-4-8", displayName: "Opus 4.8" },
  { alias: "claude-opus-4-7", displayName: "Opus 4.7" },
  { alias: "claude-opus-4-6", displayName: "Opus 4.6" },
  { alias: "claude-sonnet-4-6", displayName: "Sonnet 4.6" },
  { alias: "claude-sonnet-4-5", displayName: "Sonnet 4.5" },
  { alias: "claude-opus-4-5", displayName: "Opus 4.5" },
  { alias: "claude-haiku-4-5", displayName: "Haiku 4.5" },
]

export const DEFAULT_CODEX_MODELS: AgentModel[] = [
  { alias: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { alias: "gpt-5.6-terra", displayName: "GPT-5.6 Terra" },
  { alias: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { alias: "gpt-5.5", displayName: "GPT-5.5" },
  { alias: "gpt-5.4", displayName: "GPT-5.4" },
  { alias: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
  { alias: "gpt-5.3-codex-spark", displayName: "GPT-5.3 Codex Spark" },
]

const DEFAULT_COPILOT_MODELS: AgentModel[] = [
  { alias: "claude-fable-5", displayName: "Claude Fable 5" },
  { alias: "claude-opus-5", displayName: "Claude Opus 5" },
  { alias: "claude-opus-4.8", displayName: "Claude Opus 4.8" },
  { alias: "claude-opus-4.8-fast", displayName: "Claude Opus 4.8 Fast" },
  { alias: "claude-opus-4.7", displayName: "Claude Opus 4.7" },
  { alias: "claude-opus-4.6", displayName: "Claude Opus 4.6" },
  { alias: "claude-opus-4.5", displayName: "Claude Opus 4.5" },
  { alias: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { alias: "claude-sonnet-4.6", displayName: "Claude Sonnet 4.6" },
  { alias: "claude-sonnet-4.5", displayName: "Claude Sonnet 4.5" },
  { alias: "claude-haiku-4.5", displayName: "Claude Haiku 4.5" },
  { alias: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { alias: "gpt-5.6-terra", displayName: "GPT-5.6 Terra" },
  { alias: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
  { alias: "gpt-5.5", displayName: "GPT-5.5" },
  { alias: "gpt-5.4", displayName: "GPT-5.4" },
  { alias: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
  { alias: "gpt-5.4-nano", displayName: "GPT-5.4 Nano" },
  { alias: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
  { alias: "gpt-5-mini", displayName: "GPT-5 Mini" },
  { alias: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
  { alias: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
  { alias: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro" },
  { alias: "gemini-3-flash", displayName: "Gemini 3 Flash" },
  { alias: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
]

const DEFAULT_GEMINI_MODELS: AgentModel[] = [
  { alias: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
  { alias: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
  { alias: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite" },
  { alias: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
  { alias: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite" },
  { alias: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { alias: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
]

const DEFAULT_OPENCODE_MODELS: AgentModel[] = [
  { alias: "anthropic/claude-opus-5", displayName: "Claude Opus 5" },
  { alias: "anthropic/claude-sonnet-5", displayName: "Claude Sonnet 5" },
  { alias: "openai/gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
  { alias: "google/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
]

// Pi's model list is environment-dependent (local ollama, configured API keys,
// installed providers). We populate it at runtime via `pi --list-models` —
// see refreshPiModels() — and start empty until that resolves.
const DEFAULT_PI_MODELS: AgentModel[] = []

class ConfigStore {
  @observable claudePath: string = FALLBACK_CLAUDE_PATH
  @observable codexPath: string = FALLBACK_CODEX_PATH
  @observable copilotPath: string = FALLBACK_COPILOT_PATH
  @observable geminiPath: string = FALLBACK_GEMINI_PATH
  @observable opencodePath: string = FALLBACK_OPENCODE_PATH
  @observable piPath: string = FALLBACK_PI_PATH
  @observable leftPaneWidth: number = DEFAULT_CONFIG.leftPaneWidth
  @observable rightPaneWidth: number = DEFAULT_CONFIG.rightPaneWidth
  @observable changesHeight: number = DEFAULT_CONFIG.changesHeight
  @observable rightPaneTab: "changes" | "commits" = DEFAULT_CONFIG.rightPaneTab
  @observable editorCommand: string = DEFAULT_CONFIG.editorCommand
  @observable terminalCommand: string = DEFAULT_CONFIG.terminalCommand
  @observable claudeModels: AgentModel[] = DEFAULT_CLAUDE_MODELS
  @observable codexModels: AgentModel[] = DEFAULT_CODEX_MODELS
  @observable copilotModels: AgentModel[] = DEFAULT_COPILOT_MODELS
  @observable geminiModels: AgentModel[] = DEFAULT_GEMINI_MODELS
  @observable opencodeModels: AgentModel[] = DEFAULT_OPENCODE_MODELS
  @observable piModels: AgentModel[] = DEFAULT_PI_MODELS
  @observable enabledAgents: AgentType[] = ALL_AGENTS
  @observable defaultAgent: AgentType | null = DEFAULT_CONFIG.defaultAgent
  @observable claudePermissionMode: ClaudePermissionMode = "default"
  @observable codexApprovalPolicy: CodexApprovalPolicy = "untrusted"
  @observable geminiApprovalMode: GeminiApprovalMode = "yolo"
  @observable defaultClaudeModel: string | null = null
  @observable defaultCodexModel: string | null = null
  @observable defaultCopilotModel: string | null = null
  @observable defaultGeminiModel: string | null = null
  @observable defaultOpencodeModel: string | null = null
  @observable defaultPiModel: string | null = null
  @observable animationsEnabled: boolean = false
  @observable showClaudeUsageIndicator: boolean = false
  @observable autonomousModeEnabled: boolean = false
  @observable remoteModelsEnabled: boolean = false
  @observable terminalOpenByDefault: boolean = false
  @observable soundNotificationEnabled: boolean = true
  @observable systemNotificationEnabled: boolean = false
  @observable showReviewPrs: boolean = false
  @observable agentShell: string = ""
  @observable settingsOpen: boolean = false
  @observable loaded: boolean = false

  // HTTP Server settings
  @observable httpServerHost: string = "127.0.0.1"
  @observable httpServerPort: number = 6767
  @observable httpServerEnableAuth: boolean = true
  @observable httpServerAutoStart: boolean = false

  private loadPromise: Promise<void> | null = null
  private home: string = ""
  private rawClaudePath: string = DEFAULT_CONFIG.claudePath
  private rawCodexPath: string = DEFAULT_CONFIG.codexPath
  private rawCopilotPath: string = DEFAULT_CONFIG.copilotPath
  private rawGeminiPath: string = DEFAULT_CONFIG.geminiPath
  private rawOpencodePath: string = DEFAULT_CONFIG.opencodePath
  private rawPiPath: string = DEFAULT_CONFIG.piPath

  constructor() {
    makeObservable(this)
    this.loadPromise = this.load()
  }

  /**
   * Wait for config to finish loading.
   * Call this before accessing paths that need to be properly resolved.
   */
  async whenLoaded(): Promise<void> {
    await this.loadPromise
  }

  private expandEnvVars(value: string): string {
    return value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
      if (name === "HOME" && this.home) {
        return this.home
      }
      return ""
    })
  }

  private async load(): Promise<void> {
    try {
      this.home = await backend.invoke<string>("get_home_dir")
      if (this.home.endsWith("/")) {
        this.home = this.home.slice(0, -1)
      }

      // Check if config exists, create with defaults if not
      const configExists = await backend.invoke<boolean>("config_file_exists", {
        filename: "config.json",
      })

      if (!configExists) {
        await backend.invoke("save_json_config", {
          filename: "config.json",
          content: DEFAULT_CONFIG,
        })
      }

      const result = await backend.invoke<Config | null>("load_json_config", {
        filename: "config.json",
      })
      const parsed = (result ?? {}) as Partial<Config>
      this.rawClaudePath = parsed.claudePath ?? DEFAULT_CONFIG.claudePath
      this.rawCodexPath = parsed.codexPath ?? DEFAULT_CONFIG.codexPath
      this.rawCopilotPath = parsed.copilotPath ?? DEFAULT_CONFIG.copilotPath
      this.rawGeminiPath = parsed.geminiPath ?? DEFAULT_CONFIG.geminiPath
      this.rawOpencodePath = parsed.opencodePath ?? DEFAULT_CONFIG.opencodePath
      this.rawPiPath = parsed.piPath ?? DEFAULT_CONFIG.piPath
      const resolved = this.expandEnvVars(this.rawClaudePath)
      const resolvedCodex = this.expandEnvVars(this.rawCodexPath)
      const resolvedCopilot = this.expandEnvVars(this.rawCopilotPath)
      const resolvedGemini = this.expandEnvVars(this.rawGeminiPath)
      const resolvedOpencode = this.expandEnvVars(this.rawOpencodePath)
      const resolvedPi = this.expandEnvVars(this.rawPiPath)

      runInAction(() => {
        this.claudePath = resolved
        this.codexPath = resolvedCodex
        this.copilotPath = resolvedCopilot
        this.geminiPath = resolvedGemini
        this.opencodePath = resolvedOpencode
        this.piPath = resolvedPi
        this.leftPaneWidth = parsed.leftPaneWidth ?? DEFAULT_CONFIG.leftPaneWidth
        this.rightPaneWidth = parsed.rightPaneWidth ?? DEFAULT_CONFIG.rightPaneWidth
        this.changesHeight = parsed.changesHeight ?? DEFAULT_CONFIG.changesHeight
        this.rightPaneTab = parsed.rightPaneTab ?? DEFAULT_CONFIG.rightPaneTab
        this.editorCommand = parsed.editorCommand ?? DEFAULT_CONFIG.editorCommand
        this.terminalCommand = parsed.terminalCommand ?? DEFAULT_CONFIG.terminalCommand
        if (Array.isArray(parsed.enabledAgents)) {
          this.enabledAgents = parsed.enabledAgents
        }
        this.defaultAgent =
          parsed.defaultAgent === undefined ? DEFAULT_CONFIG.defaultAgent : parsed.defaultAgent
        this.claudePermissionMode = parsed.claudePermissionMode ?? "default"
        this.codexApprovalPolicy = normalizeCodexApprovalPolicy(parsed.codexApprovalPolicy)
        this.geminiApprovalMode = parsed.geminiApprovalMode ?? "yolo"
        this.defaultClaudeModel = parsed.defaultClaudeModel ?? null
        this.defaultCodexModel = parsed.defaultCodexModel ?? null
        this.defaultCopilotModel = parsed.defaultCopilotModel ?? null
        this.defaultGeminiModel = parsed.defaultGeminiModel ?? null
        this.defaultOpencodeModel = parsed.defaultOpencodeModel ?? null
        this.defaultPiModel = parsed.defaultPiModel ?? null
        this.animationsEnabled = parsed.animationsEnabled ?? false
        this.showClaudeUsageIndicator = parsed.showClaudeUsageIndicator ?? false
        this.autonomousModeEnabled = parsed.autonomousModeEnabled ?? false
        this.remoteModelsEnabled = parsed.remoteModelsEnabled ?? false
        this.terminalOpenByDefault = parsed.terminalOpenByDefault ?? false
        this.soundNotificationEnabled = parsed.soundNotificationEnabled ?? true
        this.systemNotificationEnabled = parsed.systemNotificationEnabled ?? false
        this.showReviewPrs = parsed.showReviewPrs ?? false
        this.agentShell = parsed.agentShell ?? ""
        // HTTP Server settings
        if (parsed.httpServer) {
          this.httpServerHost = parsed.httpServer.host ?? "127.0.0.1"
          this.httpServerPort = parsed.httpServer.port ?? 6767
          this.httpServerEnableAuth = parsed.httpServer.enableAuth ?? true
          this.httpServerAutoStart = parsed.httpServer.autoStart ?? false
        }
        // Remote servers
        if (Array.isArray(parsed.remoteServers)) {
          remoteServerStore.initFromConfig(parsed.remoteServers)
        }
        this.loaded = true
      })

      // Auto-connect to remote servers after config is loaded
      remoteServerStore.autoConnectServers().catch((err) => {
        console.error("Failed to auto-connect to remote servers:", err)
      })

      // Fetch latest models from GitHub in the background (opt-in)
      if (this.remoteModelsEnabled) {
        void this.refreshRemoteModels()
      }
    } catch (err) {
      console.error("Failed to load config, falling back to bare 'claude':", err)
      runInAction(() => {
        this.claudePath = FALLBACK_CLAUDE_PATH
        this.loaded = true
      })
    }
  }

  private async save(): Promise<void> {
    // Don't save until config is loaded to avoid overwriting with defaults
    if (!this.loaded) {
      return
    }
    try {
      const config: Config = {
        claudePath: this.rawClaudePath,
        codexPath: this.rawCodexPath,
        copilotPath: this.rawCopilotPath,
        geminiPath: this.rawGeminiPath,
        opencodePath: this.rawOpencodePath,
        piPath: this.rawPiPath,
        leftPaneWidth: this.leftPaneWidth,
        rightPaneWidth: this.rightPaneWidth,
        changesHeight: this.changesHeight,
        rightPaneTab: this.rightPaneTab,
        editorCommand: this.editorCommand,
        terminalCommand: this.terminalCommand,
        enabledAgents: this.enabledAgents,
        defaultAgent: this.defaultAgent,
        defaultClaudeModel: this.defaultClaudeModel,
        defaultCodexModel: this.defaultCodexModel,
        defaultCopilotModel: this.defaultCopilotModel,
        defaultGeminiModel: this.defaultGeminiModel,
        defaultOpencodeModel: this.defaultOpencodeModel,
        defaultPiModel: this.defaultPiModel,
        claudePermissionMode: this.claudePermissionMode,
        codexApprovalPolicy: this.codexApprovalPolicy,
        geminiApprovalMode: this.geminiApprovalMode,
        animationsEnabled: this.animationsEnabled,
        showClaudeUsageIndicator: this.showClaudeUsageIndicator,
        autonomousModeEnabled: this.autonomousModeEnabled,
        remoteModelsEnabled: this.remoteModelsEnabled,
        terminalOpenByDefault: this.terminalOpenByDefault,
        soundNotificationEnabled: this.soundNotificationEnabled,
        systemNotificationEnabled: this.systemNotificationEnabled,
        showReviewPrs: this.showReviewPrs,
        agentShell: this.agentShell || undefined,
        httpServer: {
          host: this.httpServerHost,
          port: this.httpServerPort,
          enableAuth: this.httpServerEnableAuth,
          autoStart: this.httpServerAutoStart,
        },
        remoteServers: remoteServerStore.getConfigs(),
      }
      await backend.invoke("save_json_config", {
        filename: "config.json",
        content: config,
      })
    } catch (err) {
      console.error("Failed to save config:", err)
    }
  }

  @action setLeftPaneWidth(width: number) {
    this.leftPaneWidth = width
    this.save()
  }

  @action setRightPaneWidth(width: number) {
    this.rightPaneWidth = width
    this.save()
  }

  @action setChangesHeight(height: number) {
    this.changesHeight = height
    this.save()
  }

  @action setRightPaneTab(tab: "changes" | "commits") {
    this.rightPaneTab = tab
    this.save()
  }

  @action setDefaultAgent(agent: AgentType | null) {
    this.defaultAgent = agent
    this.save()
  }

  @action setAgentEnabled(agent: AgentType, enabled: boolean) {
    if (enabled) {
      if (!this.enabledAgents.includes(agent)) {
        this.enabledAgents = [...this.enabledAgents, agent]
      }
    } else {
      this.enabledAgents = this.enabledAgents.filter((a) => a !== agent)
      // If the disabled agent was the default, clear the default
      if (this.defaultAgent === agent) {
        this.defaultAgent = null
      }
    }
    this.save()
  }

  isAgentEnabled(agent: AgentType): boolean {
    return this.enabledAgents.includes(agent)
  }

  @action setClaudePermissionMode(mode: ClaudePermissionMode) {
    this.claudePermissionMode = mode
    this.save()
  }

  @action setCodexApprovalPolicy(policy: CodexApprovalPolicy) {
    this.codexApprovalPolicy = policy
    this.save()
  }

  @action setGeminiApprovalMode(mode: GeminiApprovalMode) {
    this.geminiApprovalMode = mode
    this.save()
  }

  @action setDefaultClaudeModel(model: string | null) {
    this.defaultClaudeModel = model
    this.save()
  }

  @action setDefaultCodexModel(model: string | null) {
    this.defaultCodexModel = model
    this.save()
  }

  @action setDefaultCopilotModel(model: string | null) {
    this.defaultCopilotModel = model
    this.save()
  }

  @action setDefaultGeminiModel(model: string | null) {
    this.defaultGeminiModel = model
    this.save()
  }

  @action setDefaultOpencodeModel(model: string | null) {
    this.defaultOpencodeModel = model
    this.save()
  }

  @action setDefaultPiModel(model: string | null) {
    this.defaultPiModel = model
    this.save()
  }

  getModelsForAgent(agentType: AgentType): AgentModel[] {
    switch (agentType) {
      case "claude":
        return this.claudeModels
      case "codex":
        return this.codexModels
      case "copilot":
        return this.copilotModels
      case "gemini":
        return this.geminiModels
      case "opencode":
        return this.opencodeModels
      case "pi":
        return this.piModels
      default:
        return []
    }
  }

  getDefaultModelForAgent(agentType: AgentType): string | null {
    switch (agentType) {
      case "claude":
        return this.defaultClaudeModel
      case "codex":
        return this.defaultCodexModel
      case "copilot":
        return this.defaultCopilotModel
      case "gemini":
        return this.defaultGeminiModel
      case "opencode":
        return this.defaultOpencodeModel
      case "pi":
        return this.defaultPiModel
      default:
        return null
    }
  }

  @action setEditorCommand(cmd: string) {
    this.editorCommand = cmd
    this.save()
  }

  @action setTerminalCommand(cmd: string) {
    this.terminalCommand = cmd
    this.save()
  }

  @action setAnimationsEnabled(enabled: boolean) {
    this.animationsEnabled = enabled
    this.save()
  }

  @action setShowClaudeUsageIndicator(enabled: boolean) {
    this.showClaudeUsageIndicator = enabled
    this.save()
  }

  @action setAutonomousModeEnabled(enabled: boolean) {
    this.autonomousModeEnabled = enabled
    this.save()
  }

  @action setTerminalOpenByDefault(enabled: boolean) {
    this.terminalOpenByDefault = enabled
    this.save()
  }

  @action setSoundNotificationEnabled(enabled: boolean) {
    this.soundNotificationEnabled = enabled
    this.save()
  }

  @action setSystemNotificationEnabled(enabled: boolean) {
    this.systemNotificationEnabled = enabled
    this.save()
  }

  @action setShowReviewPrs(enabled: boolean) {
    this.showReviewPrs = enabled
    this.save()
  }

  @action setAgentShell(shell: string) {
    this.agentShell = shell
    this.save()
  }

  @action setSettingsOpen(open: boolean) {
    this.settingsOpen = open
  }

  @action setRemoteModelsEnabled(enabled: boolean) {
    this.remoteModelsEnabled = enabled
    this.save()
  }

  /**
   * Fetch the latest model lists from GitHub and update the observables.
   * Only called when remoteModelsEnabled is true. Falls back to hardcoded
   * defaults silently if the fetch fails or the response is invalid.
   */
  async refreshRemoteModels(): Promise<void> {
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/marcinbunsch/overseer/main/models.json"
      )
      if (!response.ok) return
      const parsed = RemoteModelsSchema.safeParse(await response.json())
      if (!parsed.success) return
      const data = parsed.data
      runInAction(() => {
        if (data.claude && data.claude.length > 0) this.claudeModels = data.claude
        if (data.codex && data.codex.length > 0) this.codexModels = data.codex
        if (data.copilot && data.copilot.length > 0) this.copilotModels = data.copilot
        if (data.gemini && data.gemini.length > 0) this.geminiModels = data.gemini
        if (data.opencode && data.opencode.length > 0) this.opencodeModels = data.opencode
      })
    } catch {
      // Network unavailable — silently keep hardcoded defaults
    }
  }

  /**
   * Refresh OpenCode models by running the CLI command.
   * Updates the opencodeModels observable with fresh data.
   */
  async refreshOpencodeModels(): Promise<void> {
    try {
      const models = await listOpencodeModels(this.opencodePath, this.agentShell || null)
      if (models.length > 0) {
        runInAction(() => {
          this.opencodeModels = models
        })
      }
    } catch (err) {
      console.error("Failed to refresh OpenCode models:", err)
    }
  }

  /**
   * Refresh Pi models by running `pi --list-models`.
   * Updates the piModels observable with fresh data.
   */
  async refreshPiModels(): Promise<void> {
    try {
      const models = await listPiModels(this.piPath, this.agentShell || null)
      runInAction(() => {
        this.piModels = models
      })
    } catch (err) {
      console.error("Failed to refresh Pi models:", err)
    }
  }

  // --- HTTP Server settings ---

  @action setHttpServerHost(host: string) {
    this.httpServerHost = host
    this.save()
  }

  @action setHttpServerPort(port: number) {
    this.httpServerPort = port
    this.save()
  }

  @action setHttpServerEnableAuth(enabled: boolean) {
    this.httpServerEnableAuth = enabled
    this.save()
  }

  @action setHttpServerAutoStart(enabled: boolean) {
    this.httpServerAutoStart = enabled
    this.save()
  }

  /**
   * Update all HTTP server settings at once.
   * Used when starting/configuring the server.
   */
  @action setHttpServerConfig(config: {
    host?: string
    port?: number
    enableAuth?: boolean
    autoStart?: boolean
  }) {
    if (config.host !== undefined) this.httpServerHost = config.host
    if (config.port !== undefined) this.httpServerPort = config.port
    if (config.enableAuth !== undefined) this.httpServerEnableAuth = config.enableAuth
    if (config.autoStart !== undefined) this.httpServerAutoStart = config.autoStart
    this.save()
  }

  /**
   * Save remote servers config.
   * Called when remote servers are added/removed/updated.
   */
  saveRemoteServers(): void {
    this.save()
  }
}

export const configStore = new ConfigStore()
