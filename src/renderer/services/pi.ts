import { backend, type Unsubscribe } from "../backend"
import type { AgentModel, ToolMeta } from "../types"
import type { AgentService, AgentEventCallback, AgentDoneCallback, AgentEvent } from "./types"
import { configStore } from "../stores/ConfigStore"
import { toolAvailabilityStore } from "../stores/ToolAvailabilityStore"

/** Model info returned from `pi --list-models`. */
interface PiModelInfo {
  id: string
  name: string
  provider: string
}

/**
 * Pi model aliases encode the provider as a prefix:
 * `"<provider>/<modelId>"`. The provider is everything before the first `/`;
 * the model id is the rest (which may itself contain `/`).
 */
function splitPiModelAlias(alias: string): { provider: string; modelId: string } {
  const slash = alias.indexOf("/")
  if (slash <= 0) return { provider: "", modelId: alias }
  return {
    provider: alias.substring(0, slash),
    modelId: alias.substring(slash + 1),
  }
}

/**
 * Fetch available Pi models by running `pi --list-models`.
 * Used by ConfigStore to populate the model selector.
 */
export async function listPiModels(
  piPath: string,
  agentShell: string | null
): Promise<AgentModel[]> {
  try {
    const models = await backend.invoke<PiModelInfo[]>("pi_list_models", {
      piPath,
      agentShell,
    })
    return models.map((m) => ({
      alias: m.id,
      displayName: m.provider ? `${m.provider} · ${m.name}` : m.name,
    }))
  } catch (err) {
    console.error("Failed to list Pi models:", err)
    return []
  }
}

/**
 * Detect if an error indicates the CLI tool is not installed.
 */
function isCommandNotFoundError(error: string): boolean {
  const lowerError = error.toLowerCase()
  return (
    lowerError.includes("command not found") ||
    lowerError.includes("enoent") ||
    lowerError.includes("no such file or directory") ||
    lowerError.includes("not found") ||
    lowerError.includes("cannot find")
  )
}

/**
 * Format a user-friendly error message for spawn failures.
 */
function formatSpawnError(error: unknown, piPath: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  if (isCommandNotFoundError(errorStr)) {
    toolAvailabilityStore.markUnavailable("pi", errorStr)

    return `Pi CLI not found at "${piPath}".

To fix this:
1. Install Pi: npm install -g @mariozechner/pi-coding-agent
2. Or update the path in Settings → Agents → Pi

Current path: ${piPath}`
  }

  return errorStr
}

/**
 * Rust AgentEvent from overseer-core (internally-tagged serde format).
 * These are pre-parsed events emitted from Rust via pi:event: channel.
 */
interface RustAgentEvent {
  kind: string
  // Text event
  text?: string
  // Message event
  content?: string
  tool_meta?: {
    tool_name: string
    lines_added?: number
    lines_removed?: number
  }
  parent_tool_use_id?: string
  tool_use_id?: string
  is_info?: boolean
  // SessionId event
  session_id?: string
  // Error event
  message?: string
}

interface PiChat {
  running: boolean
  serverStarted: boolean
  workingDir: string
  unlistenEvent: Unsubscribe | null
  unlistenStderr: Unsubscribe | null
  unlistenClose: Unsubscribe | null
}

/**
 * PiAgentService manages communication with the Pi coding agent CLI
 * using its RPC mode (JSONL over stdin/stdout).
 *
 * Architecture:
 * - One persistent `pi --mode rpc` process per chat.
 * - First sendMessage starts the process, subsequent ones send prompt commands via stdin.
 * - No interactive tool approvals — tools execute freely.
 * - Session management handled internally by Pi.
 */
class PiAgentService implements AgentService {
  private chats: Map<string, PiChat> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()

  private getOrCreateChat(chatId: string): PiChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = {
        running: false,
        serverStarted: false,
        workingDir: "",
        unlistenEvent: null,
        unlistenStderr: null,
        unlistenClose: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)

    if (!chat.unlistenEvent) {
      chat.unlistenEvent = await backend.listen<RustAgentEvent>(`pi:event:${chatId}`, (payload) => {
        if (payload) {
          this.handleRustEvent(chatId, payload)
        }
      })
    }

    if (!chat.unlistenStderr) {
      chat.unlistenStderr = await backend.listen<string>(`pi:stderr:${chatId}`, (payload) => {
        if (payload) {
          console.warn(`Pi stderr [${chatId}]:`, payload)
        }
      })
    }

    if (!chat.unlistenClose) {
      chat.unlistenClose = await backend.listen<{ code: number }>(`pi:close:${chatId}`, () => {
        chat.running = false
        chat.serverStarted = false
        this.emitEvent(chatId, { kind: "turnComplete" })
        this.doneCallbacks.get(chatId)?.()
      })
    }
  }

  /**
   * Handle pre-parsed AgentEvent from Rust.
   */
  private handleRustEvent(chatId: string, rustEvent: RustAgentEvent): void {
    switch (rustEvent.kind) {
      case "text":
        this.emitEvent(chatId, { kind: "text", text: rustEvent.text ?? "" })
        break

      case "message": {
        let toolMeta: ToolMeta | undefined
        if (rustEvent.tool_meta) {
          toolMeta = {
            toolName: rustEvent.tool_meta.tool_name,
            linesAdded: rustEvent.tool_meta.lines_added,
            linesRemoved: rustEvent.tool_meta.lines_removed,
          }
        }
        this.emitEvent(chatId, {
          kind: "message",
          content: rustEvent.content ?? "",
          toolMeta,
          parentToolUseId: rustEvent.parent_tool_use_id,
          toolUseId: rustEvent.tool_use_id,
          isInfo: rustEvent.is_info,
        })
        break
      }

      case "bashOutput":
        this.emitEvent(chatId, { kind: "bashOutput", text: rustEvent.text ?? "" })
        break

      case "turnComplete":
        this.emitEvent(chatId, { kind: "turnComplete" })
        break

      case "done":
        this.emitEvent(chatId, { kind: "done" })
        break

      default:
        console.warn(`Unknown Pi event kind: ${rustEvent.kind}`)
    }
  }

  async sendMessage(
    chatId: string,
    prompt: string,
    workingDir: string,
    logDir?: string,
    modelVersion?: string | null,
    _permissionMode?: string | null,
    initPrompt?: string
  ): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    chat.workingDir = workingDir

    // If the RPC server isn't running yet, start it
    if (!chat.serverStarted) {
      await this.attachListeners(chatId)

      console.log(`Starting Pi RPC process [${chatId}] in dir:`, workingDir)

      try {
        await backend.invoke("start_pi_server", {
          serverId: chatId,
          piPath: configStore.piPath,
          workingDir,
          logDir: logDir ?? null,
          logId: chatId,
          agentShell: configStore.agentShell || null,
        })
        chat.serverStarted = true
      } catch (err) {
        throw new Error(formatSpawnError(err, configStore.piPath))
      }

      // If a model was specified, set it before sending the prompt.
      // Pi requires provider + modelId separately; the alias encodes both as
      // "provider/modelId".
      if (modelVersion) {
        const { provider, modelId } = splitPiModelAlias(modelVersion)
        await this.sendRpcCommand(chatId, {
          type: "set_model",
          provider,
          modelId,
        })
      }
    }

    // Build the prompt message
    const isNewSession = chat.running === false && initPrompt
    const messageText = isNewSession ? `${initPrompt}\n\n${prompt}` : prompt

    // Send prompt via RPC
    chat.running = true
    await this.sendRpcCommand(chatId, { type: "prompt", message: messageText })
  }

  /**
   * Send an RPC command to the Pi process via stdin.
   */
  private async sendRpcCommand(chatId: string, command: Record<string, unknown>): Promise<void> {
    const json = JSON.stringify(command)
    await backend.invoke("pi_stdin", { serverId: chatId, data: json + "\n" })
  }

  /**
   * No-op — Pi doesn't support interactive tool approvals.
   */
  async sendToolApproval(
    _chatId: string,
    _requestId: string,
    _approved: boolean,
    _toolInput?: Record<string, unknown>,
    _denyMessage?: string
  ): Promise<void> {
    // No-op: Pi doesn't have interactive tool approvals
  }

  async interruptTurn(chatId: string): Promise<void> {
    // Send abort command to cancel current work
    try {
      await this.sendRpcCommand(chatId, { type: "abort" })
    } catch {
      // If stdin write fails, the process may have exited
      await this.stopChat(chatId)
    }
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (chat) {
      chat.running = false
      chat.serverStarted = false
    }
    await backend.invoke("stop_pi_server", { serverId: chatId })
  }

  isRunning(chatId: string): boolean {
    return this.chats.get(chatId)?.running ?? false
  }

  getSessionId(_chatId: string): string | null {
    // Pi manages sessions internally — no external session ID needed
    return null
  }

  setSessionId(_chatId: string, _sessionId: string | null): void {
    // No-op: Pi manages sessions internally
  }

  removeChat(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (chat) {
      chat.unlistenEvent?.()
      chat.unlistenStderr?.()
      chat.unlistenClose?.()
    }
    this.chats.delete(chatId)
    this.eventCallbacks.delete(chatId)
    this.doneCallbacks.delete(chatId)
  }

  onEvent(chatId: string, callback: AgentEventCallback): void {
    this.eventCallbacks.set(chatId, callback)
  }

  onDone(chatId: string, callback: AgentDoneCallback): void {
    this.doneCallbacks.set(chatId, callback)
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const piAgentService = new PiAgentService()
