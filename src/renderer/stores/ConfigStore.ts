import { observable, action, makeObservable, runInAction } from "mobx"
import type { AgentModel, AgentType } from "../types"
import { listOpencodeModels } from "../services/opencode"
import { backend } from "../backend"

export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions"
export type CodexApprovalPolicy = "untrusted" | "full-auto"
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
  agentShell?: string
  leftPaneWidth: number
  rightPaneWidth: number
  changesHeight: number
  editorCommand: string
  terminalCommand: string
  claudeModels?: AgentModel[]
  codexModels?: AgentModel[]
  copilotModels?: AgentModel[]
  geminiModels?: AgentModel[]
  opencodeModels?: AgentModel[]
  enabledAgents?: AgentType[]
  defaultAgent: AgentType | null
  defaultClaudeModel?: string | null
  defaultCodexModel?: string | null
  defaultCopilotModel?: string | null
  defaultGeminiModel?: string | null
  defaultOpencodeModel?: string | null
  claudePermissionMode?: ClaudePermissionMode
  codexApprovalPolicy?: CodexApprovalPolicy
  geminiApprovalMode?: GeminiApprovalMode
  animationsEnabled?: boolean
  httpServer?: HttpServerConfig
}

const ALL_AGENTS: AgentType[] = ["claude", "codex", "copilot", "gemini", "opencode"]

const DEFAULT_CONFIG: Config = {
  claudePath: "$HOME/.local/bin/claude",
  codexPath: "codex",
  copilotPath: "copilot",
  geminiPath: "gemini",
  opencodePath: "opencode",
  leftPaneWidth: 250,
  rightPaneWidth: 300,
  changesHeight: 250,
  editorCommand: "code",
  terminalCommand: "open -a iTerm",
  enabledAgents: ALL_AGENTS,
  defaultAgent: "claude",
}

const FALLBACK_CLAUDE_PATH = "claude"
const FALLBACK_CODEX_PATH = "codex"
const FALLBACK_COPILOT_PATH = "copilot"
const FALLBACK_GEMINI_PATH = "gemini"
const FALLBACK_OPENCODE_PATH = "opencode"

const DEFAULT_CLAUDE_MODELS: AgentModel[] = [
  { alias: "claude-opus-4-6", displayName: "Opus 4.6" },
  { alias: "claude-opus-4-5", displayName: "Opus 4.5" },
  { alias: "claude-sonnet-4-6", displayName: "Sonnet 4.6" },
  { alias: "claude-sonnet-4-5", displayName: "Sonnet 4.5" },
  { alias: "claude-haiku-4-5", displayName: "Haiku 4.5" },
]

const DEFAULT_CODEX_MODELS: AgentModel[] = [
  { alias: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
  { alias: "gpt-5.2-codex", displayName: "GPT-5.2 Codex" },
  { alias: "gpt-5.1-codex-max", displayName: "GPT-5.1 Codex Max" },
  { alias: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini" },
]

const DEFAULT_COPILOT_MODELS: AgentModel[] = [
  { alias: "claude-opus-4.6", displayName: "Claude Opus 4.6" },
  { alias: "claude-opus-4.6-fast", displayName: "Claude Opus 4.6 Fast" },
  { alias: "claude-opus-4.5", displayName: "Claude Opus 4.5" },
  { alias: "claude-sonnet-4.5", displayName: "Claude Sonnet 4.5" },
  { alias: "claude-sonnet-4", displayName: "Claude Sonnet 4" },
  { alias: "claude-haiku-4.5", displayName: "Claude Haiku 4.5" },
  { alias: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
  { alias: "gpt-5.2-codex", displayName: "GPT-5.2 Codex" },
  { alias: "gpt-5.2", displayName: "GPT-5.2" },
  { alias: "gpt-5.1-codex-max", displayName: "GPT-5.1 Codex Max" },
  { alias: "gpt-5.1-codex", displayName: "GPT-5.1 Codex" },
  { alias: "gpt-5.1", displayName: "GPT-5.1" },
  { alias: "gpt-5", displayName: "GPT-5" },
  { alias: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini" },
  { alias: "gpt-5-mini", displayName: "GPT-5 Mini" },
  { alias: "gpt-4.1", displayName: "GPT-4.1" },
  { alias: "gemini-3-pro-preview", displayName: "Gemini 3 Pro Preview" },
]

const DEFAULT_GEMINI_MODELS: AgentModel[] = [
  { alias: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
  { alias: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
  { alias: "gemini-2.0-pro", displayName: "Gemini 2.0 Pro" },
  { alias: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
]

const DEFAULT_OPENCODE_MODELS: AgentModel[] = [
  { alias: "anthropic/claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
  { alias: "anthropic/claude-opus-4-5", displayName: "Claude Opus 4.5" },
  { alias: "openai/gpt-5.2", displayName: "GPT 5.2" },
  { alias: "google/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
]

class ConfigStore {
  @observable claudePath: string = FALLBACK_CLAUDE_PATH
  @observable codexPath: string = FALLBACK_CODEX_PATH
  @observable copilotPath: string = FALLBACK_COPILOT_PATH
  @observable geminiPath: string = FALLBACK_GEMINI_PATH
  @observable opencodePath: string = FALLBACK_OPENCODE_PATH
  @observable leftPaneWidth: number = DEFAULT_CONFIG.leftPaneWidth
  @observable rightPaneWidth: number = DEFAULT_CONFIG.rightPaneWidth
  @observable changesHeight: number = DEFAULT_CONFIG.changesHeight
  @observable editorCommand: string = DEFAULT_CONFIG.editorCommand
  @observable terminalCommand: string = DEFAULT_CONFIG.terminalCommand
  @observable claudeModels: AgentModel[] = DEFAULT_CLAUDE_MODELS
  @observable codexModels: AgentModel[] = DEFAULT_CODEX_MODELS
  @observable copilotModels: AgentModel[] = DEFAULT_COPILOT_MODELS
  @observable geminiModels: AgentModel[] = DEFAULT_GEMINI_MODELS
  @observable opencodeModels: AgentModel[] = DEFAULT_OPENCODE_MODELS
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
  @observable animationsEnabled: boolean = false
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
      const resolved = this.expandEnvVars(this.rawClaudePath)
      const resolvedCodex = this.expandEnvVars(this.rawCodexPath)
      const resolvedCopilot = this.expandEnvVars(this.rawCopilotPath)
      const resolvedGemini = this.expandEnvVars(this.rawGeminiPath)
      const resolvedOpencode = this.expandEnvVars(this.rawOpencodePath)

      runInAction(() => {
        this.claudePath = resolved
        this.codexPath = resolvedCodex
        this.copilotPath = resolvedCopilot
        this.geminiPath = resolvedGemini
        this.opencodePath = resolvedOpencode
        this.leftPaneWidth = parsed.leftPaneWidth ?? DEFAULT_CONFIG.leftPaneWidth
        this.rightPaneWidth = parsed.rightPaneWidth ?? DEFAULT_CONFIG.rightPaneWidth
        this.changesHeight = parsed.changesHeight ?? DEFAULT_CONFIG.changesHeight
        this.editorCommand = parsed.editorCommand ?? DEFAULT_CONFIG.editorCommand
        this.terminalCommand = parsed.terminalCommand ?? DEFAULT_CONFIG.terminalCommand
        if (Array.isArray(parsed.claudeModels) && parsed.claudeModels.length > 0) {
          this.claudeModels = parsed.claudeModels
        }
        if (Array.isArray(parsed.codexModels) && parsed.codexModels.length > 0) {
          this.codexModels = parsed.codexModels
        }
        if (Array.isArray(parsed.copilotModels) && parsed.copilotModels.length > 0) {
          this.copilotModels = parsed.copilotModels
        }
        if (Array.isArray(parsed.geminiModels) && parsed.geminiModels.length > 0) {
          this.geminiModels = parsed.geminiModels
        }
        if (Array.isArray(parsed.opencodeModels) && parsed.opencodeModels.length > 0) {
          this.opencodeModels = parsed.opencodeModels
        }
        if (Array.isArray(parsed.enabledAgents)) {
          this.enabledAgents = parsed.enabledAgents
        }
        this.defaultAgent =
          parsed.defaultAgent === undefined ? DEFAULT_CONFIG.defaultAgent : parsed.defaultAgent
        this.claudePermissionMode = parsed.claudePermissionMode ?? "default"
        this.codexApprovalPolicy = parsed.codexApprovalPolicy ?? "untrusted"
        this.geminiApprovalMode = parsed.geminiApprovalMode ?? "yolo"
        this.defaultClaudeModel = parsed.defaultClaudeModel ?? null
        this.defaultCodexModel = parsed.defaultCodexModel ?? null
        this.defaultCopilotModel = parsed.defaultCopilotModel ?? null
        this.defaultGeminiModel = parsed.defaultGeminiModel ?? null
        this.defaultOpencodeModel = parsed.defaultOpencodeModel ?? null
        this.animationsEnabled = parsed.animationsEnabled ?? false
        this.agentShell = parsed.agentShell ?? ""
        // HTTP Server settings
        if (parsed.httpServer) {
          this.httpServerHost = parsed.httpServer.host ?? "127.0.0.1"
          this.httpServerPort = parsed.httpServer.port ?? 6767
          this.httpServerEnableAuth = parsed.httpServer.enableAuth ?? true
          this.httpServerAutoStart = parsed.httpServer.autoStart ?? false
        }
        this.loaded = true
      })
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
        leftPaneWidth: this.leftPaneWidth,
        rightPaneWidth: this.rightPaneWidth,
        changesHeight: this.changesHeight,
        editorCommand: this.editorCommand,
        terminalCommand: this.terminalCommand,
        claudeModels: this.claudeModels,
        codexModels: this.codexModels,
        copilotModels: this.copilotModels,
        geminiModels: this.geminiModels,
        opencodeModels: this.opencodeModels,
        enabledAgents: this.enabledAgents,
        defaultAgent: this.defaultAgent,
        defaultClaudeModel: this.defaultClaudeModel,
        defaultCodexModel: this.defaultCodexModel,
        defaultCopilotModel: this.defaultCopilotModel,
        defaultGeminiModel: this.defaultGeminiModel,
        defaultOpencodeModel: this.defaultOpencodeModel,
        claudePermissionMode: this.claudePermissionMode,
        codexApprovalPolicy: this.codexApprovalPolicy,
        geminiApprovalMode: this.geminiApprovalMode,
        animationsEnabled: this.animationsEnabled,
        agentShell: this.agentShell || undefined,
        httpServer: {
          host: this.httpServerHost,
          port: this.httpServerPort,
          enableAuth: this.httpServerEnableAuth,
          autoStart: this.httpServerAutoStart,
        },
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
      default:
        return null
    }
  }

  @action setAnimationsEnabled(enabled: boolean) {
    this.animationsEnabled = enabled
    this.save()
  }

  @action setAgentShell(shell: string) {
    this.agentShell = shell
    this.save()
  }

  @action setSettingsOpen(open: boolean) {
    this.settingsOpen = open
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
}

export const configStore = new ConfigStore()
