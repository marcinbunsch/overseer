import { observable, action, makeObservable, runInAction } from "mobx"
import { backend } from "../backend"
import { configStore } from "./ConfigStore"

export interface ToolStatus {
  available: boolean
  version?: string
  error?: string
  lastChecked: number
}

type ToolName =
  | "claude"
  | "codex"
  | "copilot"
  | "gemini"
  | "opencode"
  | "gh"
  | "editor"
  | "terminal"

class ToolAvailabilityStore {
  @observable
  claude: ToolStatus | null = null

  @observable
  codex: ToolStatus | null = null

  @observable
  copilot: ToolStatus | null = null

  @observable
  gemini: ToolStatus | null = null

  @observable
  opencode: ToolStatus | null = null

  @observable
  gh: ToolStatus | null = null

  @observable
  editor: ToolStatus | null = null

  @observable
  terminal: ToolStatus | null = null

  constructor() {
    makeObservable(this)
  }

  /**
   * Lazy check - only runs if not already checked.
   * Returns cached result if available.
   */
  @action
  async ensureClaude(): Promise<ToolStatus> {
    if (this.claude !== null) {
      return this.claude
    }
    return this.recheckClaude()
  }

  @action
  async ensureCodex(): Promise<ToolStatus> {
    if (this.codex !== null) {
      return this.codex
    }
    return this.recheckCodex()
  }

  @action
  async ensureCopilot(): Promise<ToolStatus> {
    if (this.copilot !== null) {
      return this.copilot
    }
    return this.recheckCopilot()
  }

  @action
  async ensureGemini(): Promise<ToolStatus> {
    if (this.gemini !== null) {
      return this.gemini
    }
    return this.recheckGemini()
  }

  @action
  async ensureOpencode(): Promise<ToolStatus> {
    if (this.opencode !== null) {
      return this.opencode
    }
    return this.recheckOpencode()
  }

  @action
  async ensureGh(): Promise<ToolStatus> {
    if (this.gh !== null) {
      return this.gh
    }
    return this.recheckGh()
  }

  @action
  async ensureEditor(): Promise<ToolStatus> {
    if (this.editor !== null) {
      return this.editor
    }
    return this.recheckEditor()
  }

  @action
  async ensureTerminal(): Promise<ToolStatus> {
    if (this.terminal !== null) {
      return this.terminal
    }
    return this.recheckTerminal()
  }

  /**
   * Force re-check - always calls Tauri command.
   * Used for settings validation.
   * Waits for config to load before checking to avoid using fallback paths.
   */
  @action
  async recheckClaude(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    const status = await this.checkCommand(configStore.claudePath)
    runInAction(() => {
      this.claude = status
    })
    return status
  }

  @action
  async recheckCodex(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    const status = await this.checkCommand(configStore.codexPath)
    runInAction(() => {
      this.codex = status
    })
    return status
  }

  @action
  async recheckCopilot(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    const status = await this.checkCommand(configStore.copilotPath)
    runInAction(() => {
      this.copilot = status
    })
    return status
  }

  @action
  async recheckGemini(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    const status = await this.checkCommand(configStore.geminiPath)
    runInAction(() => {
      this.gemini = status
    })
    return status
  }

  @action
  async recheckOpencode(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    const status = await this.checkCommand(configStore.opencodePath)
    runInAction(() => {
      this.opencode = status
    })
    return status
  }

  @action
  async recheckGh(): Promise<ToolStatus> {
    const status = await this.checkCommand("gh")
    runInAction(() => {
      this.gh = status
    })
    return status
  }

  @action
  async recheckEditor(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    // Editor command may have args, extract just the binary
    const editorBinary = configStore.editorCommand.split(/\s+/)[0]
    const status = await this.checkCommand(editorBinary)
    runInAction(() => {
      this.editor = status
    })
    return status
  }

  @action
  async recheckTerminal(): Promise<ToolStatus> {
    await configStore.whenLoaded()
    // Terminal command may have args like "open -a iTerm"
    const terminalBinary = configStore.terminalCommand.split(/\s+/)[0]
    const status = await this.checkCommand(terminalBinary)
    runInAction(() => {
      this.terminal = status
    })
    return status
  }

  /**
   * Invalidate cached status - called when config changes.
   */
  @action
  invalidate(tool: ToolName): void {
    this[tool] = null
  }

  /**
   * Invalidate all cached statuses.
   */
  @action
  invalidateAll(): void {
    this.claude = null
    this.codex = null
    this.copilot = null
    this.gemini = null
    this.opencode = null
    this.gh = null
    this.editor = null
    this.terminal = null
  }

  /**
   * Mark a tool as unavailable with an error message.
   * Called when spawn fails to update the cached status.
   */
  @action
  markUnavailable(tool: ToolName, error: string): void {
    this[tool] = {
      available: false,
      error,
      lastChecked: Date.now(),
    }
  }

  private async checkCommand(command: string): Promise<ToolStatus> {
    try {
      const result = await backend.invoke<{ available: boolean; version?: string; error?: string }>(
        "check_command_exists",
        { command }
      )
      return {
        available: result.available,
        version: result.version,
        error: result.error,
        lastChecked: Date.now(),
      }
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err),
        lastChecked: Date.now(),
      }
    }
  }
}

export const toolAvailabilityStore = new ToolAvailabilityStore()
