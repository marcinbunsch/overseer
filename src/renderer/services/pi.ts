import { backend, type Unsubscribe } from "../backend"
import type { AgentModel, QuestionItem, ToolMeta } from "../types"
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
  // Question event (from extension_ui_request)
  request_id?: string
  questions?: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multi_select?: boolean
  }>
  raw_input?: Record<string, unknown>
  is_processed?: boolean
}

interface PiChat {
  running: boolean
  serverStarted: boolean
  workingDir: string
  /**
   * Stable Pi session ID. Generated once on the first message and passed to Pi
   * via `--session-id` so a restarted RPC process (after app restart, crash, or
   * manual stop) resumes the same conversation's context. Persisted to chat
   * metadata via the emitted `sessionId` event, then restored with setSessionId.
   */
  sessionId: string | null
  /**
   * The model alias last sent to Pi via `set_model`. Used to detect when the
   * user changes the model mid-session so we can push a new `set_model` RPC
   * before the next prompt.
   */
  currentModel: string | null
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
        sessionId: null,
        currentModel: null,
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

      case "thinking":
        this.emitEvent(chatId, { kind: "thinking", text: rustEvent.text ?? "" })
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

      case "question": {
        // From an extension_ui_request (method "select"). Reuses the shared
        // question UI; the answer is sent back via sendToolApproval below.
        const questions: QuestionItem[] = (rustEvent.questions ?? []).map((item) => ({
          question: item.question,
          header: item.header,
          options: item.options,
          multiSelect: item.multi_select ?? false,
        }))
        this.emitEvent(chatId, {
          kind: "question",
          id: rustEvent.request_id ?? "",
          questions,
          rawInput: rustEvent.raw_input ?? {},
          isProcessed: rustEvent.is_processed ?? false,
        })
        break
      }

      case "turnComplete":
        this.emitEvent(chatId, { kind: "turnComplete" })
        break

      case "done": {
        // Pi's RPC process is persistent, so agent_end (→ done) signals the end
        // of this prompt cycle, not process exit. The UI's isSending flag is
        // cleared via doneCallbacks, so we must fire them here (pi:close only
        // fires on actual process shutdown).
        const chat = this.chats.get(chatId)
        if (chat) {
          chat.running = false
        }
        this.emitEvent(chatId, { kind: "done" })
        this.doneCallbacks.get(chatId)?.()
        break
      }

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

    // Whether this is the very first prompt of a brand-new session. Captured
    // before we generate the session ID below so initPrompt is only prepended
    // once, not on every message.
    const isFirstMessage = !chat.sessionId

    // If the RPC server isn't running yet, start it
    if (!chat.serverStarted) {
      await this.attachListeners(chatId)

      // Ensure a stable session ID exists before spawning. On a fresh chat we
      // generate one; on restart it was restored via setSessionId. Either way
      // Pi resumes (or creates) this exact session via --session-id.
      if (!chat.sessionId) {
        chat.sessionId = crypto.randomUUID()
        this.emitEvent(chatId, { kind: "sessionId", sessionId: chat.sessionId })
      }

      console.log(
        `Starting Pi RPC process [${chatId}] in dir:`,
        workingDir,
        "session:",
        chat.sessionId
      )

      try {
        await backend.invoke("start_pi_server", {
          serverId: chatId,
          piPath: configStore.piPath,
          workingDir,
          logDir: logDir ?? null,
          logId: chatId,
          agentShell: configStore.agentShell || null,
          sessionId: chat.sessionId,
        })
        chat.serverStarted = true
      } catch (err) {
        throw new Error(formatSpawnError(err, configStore.piPath))
      }
    }

    // Push set_model whenever the requested model differs from the one Pi is
    // currently configured with — covers both the first message (currentModel
    // is null) and user-driven changes mid-session.
    //
    // Pi requires provider + modelId separately; the alias encodes both as
    // "provider/modelId".
    const requestedModel = modelVersion ?? null
    if (requestedModel && requestedModel !== chat.currentModel) {
      const { provider, modelId } = splitPiModelAlias(requestedModel)
      await this.sendRpcCommand(chatId, {
        type: "set_model",
        provider,
        modelId,
      })
      chat.currentModel = requestedModel
    }

    // Build the prompt message. Prepend initPrompt only on the very first
    // message of a new session (keyed off the session ID, not the per-turn
    // running flag which resets after every turn).
    const messageText = isFirstMessage && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

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
   * Answer a Pi interactive dialog (currently only `select`, surfaced as a
   * question). Pi is blocked on the tool until it receives an
   * `extension_ui_response` on stdin with the matching request id.
   * See docs/pi/prompts.md.
   */
  async sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    toolInput?: Record<string, unknown>,
    _denyMessage?: string
  ): Promise<void> {
    if (!approved) {
      await this.sendRpcCommand(chatId, {
        type: "extension_ui_response",
        id: requestId,
        cancelled: true,
      })
      return
    }
    // The question UI keys answers by question header; a select has one answer.
    const answers = (toolInput?.answers ?? {}) as Record<string, string>
    const value = Object.values(answers)[0] ?? ""
    await this.sendRpcCommand(chatId, {
      type: "extension_ui_response",
      id: requestId,
      value,
    })
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

  getSessionId(chatId: string): string | null {
    return this.chats.get(chatId)?.sessionId ?? null
  }

  setSessionId(chatId: string, sessionId: string | null): void {
    // Restores the persisted session ID (e.g. on chat load) so the next spawn
    // resumes Pi's session via --session-id.
    const chat = this.getOrCreateChat(chatId)
    chat.sessionId = sessionId
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
