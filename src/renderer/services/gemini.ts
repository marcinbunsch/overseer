import { backend, type Unsubscribe } from "../backend"
import type { ToolMeta } from "../types"
import type { AgentService, AgentEventCallback, AgentDoneCallback, AgentEvent } from "./types"
import { configStore } from "../stores/ConfigStore"
import { toolAvailabilityStore } from "../stores/ToolAvailabilityStore"

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
function formatSpawnError(error: unknown, geminiPath: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  if (isCommandNotFoundError(errorStr)) {
    toolAvailabilityStore.markUnavailable("gemini", errorStr)

    return `Gemini CLI not found at "${geminiPath}".

To fix this:
1. Install Gemini CLI: npm install -g @google/gemini-cli
2. Or update the path in ~/.config/overseer/config.json

Current path: ${geminiPath}`
  }

  return errorStr
}

/**
 * Rust AgentEvent from overseer-core (internally-tagged serde format).
 * These are pre-parsed events emitted from Rust via gemini:event: channel.
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
  // BashOutput event (uses 'text' field)
}

interface GeminiChat {
  sessionId: string | null
  running: boolean
  workingDir: string
  unlistenEvent: Unsubscribe | null
  unlistenStderr: Unsubscribe | null
  unlistenClose: Unsubscribe | null
  /** Count of rate limit retries - used to detect death spirals */
  rateLimitCount: number
  /** True if the last emitted message was an info message (rate limit, etc.) */
  lastWasInfo: boolean
}

/** Max rate limit retries before circuit breaker trips */
const RATE_LIMIT_CIRCUIT_BREAKER = 10

/**
 * GeminiAgentService manages communication with Gemini CLI using the headless
 * NDJSON streaming protocol.
 *
 * Architecture:
 * - One process per message (one-shot model).
 * - Each message spawns a new `gemini -p <prompt> --output-format stream-json` process.
 * - Session continuity via `--resume <session-id>` flag.
 * - No interactive tool approvals — uses `--approval-mode yolo` or `auto_edit`.
 */
class GeminiAgentService implements AgentService {
  private chats: Map<string, GeminiChat> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()

  private getOrCreateChat(chatId: string): GeminiChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = {
        sessionId: null,
        running: false,
        workingDir: "",
        unlistenEvent: null,
        unlistenStderr: null,
        unlistenClose: null,
        rateLimitCount: 0,
        lastWasInfo: false,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)

    if (!chat.unlistenEvent) {
      chat.unlistenEvent = await backend.listen<RustAgentEvent>(
        `gemini:event:${chatId}`,
        (payload) => {
          if (payload) {
            this.handleRustEvent(chatId, payload)
          }
        }
      )
    }

    if (!chat.unlistenStderr) {
      chat.unlistenStderr = await backend.listen<string>(`gemini:stderr:${chatId}`, (payload) => {
        if (payload) {
          console.warn(`Gemini stderr [${chatId}]:`, payload)
          if (payload.includes("exhausted your capacity") || payload.includes("Retrying after")) {
            chat.rateLimitCount++

            // Circuit breaker: stop if too many rate limits (likely a death spiral)
            if (chat.rateLimitCount >= RATE_LIMIT_CIRCUIT_BREAKER) {
              this.emitEvent(chatId, {
                kind: "message",
                content:
                  "Stopped: Too many rate limit retries. The Gemini CLI may be in a loop. See https://github.com/google-gemini/gemini-cli/issues/6420",
                isInfo: true,
              })
              this.emitEvent(chatId, { kind: "turnComplete" })
              this.stopChat(chatId)
              return
            }

            // Extract a user-friendly message
            const match = payload.match(/Your quota will reset after (\d+)s/)
            const resetTime = match ? match[1] : null
            const infoMsg = resetTime
              ? `Rate limited. Retrying in ${resetTime}s... (${chat.rateLimitCount}/${RATE_LIMIT_CIRCUIT_BREAKER})`
              : `Rate limited. Retrying... (${chat.rateLimitCount}/${RATE_LIMIT_CIRCUIT_BREAKER})`
            chat.lastWasInfo = true
            this.emitEvent(chatId, { kind: "message", content: infoMsg, isInfo: true })
          }
        }
      })
    }

    if (!chat.unlistenClose) {
      chat.unlistenClose = await backend.listen<{ code: number }>(`gemini:close:${chatId}`, () => {
        chat.running = false
        this.emitEvent(chatId, { kind: "turnComplete" })
        this.doneCallbacks.get(chatId)?.()
      })
    }
  }

  /**
   * Handle pre-parsed AgentEvent from Rust.
   */
  private handleRustEvent(chatId: string, rustEvent: RustAgentEvent): void {
    const chat = this.chats.get(chatId)

    // Reset rate limit counter on any successful event
    if (chat) {
      chat.rateLimitCount = 0
    }

    switch (rustEvent.kind) {
      case "text":
        // If the last message was an info message (e.g., rate limit), start a new message
        if (chat?.lastWasInfo) {
          chat.lastWasInfo = false
          this.emitEvent(chatId, { kind: "message", content: rustEvent.text ?? "" })
        } else {
          this.emitEvent(chatId, { kind: "text", text: rustEvent.text ?? "" })
        }
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

      case "sessionId":
        if (rustEvent.session_id && chat) {
          chat.sessionId = rustEvent.session_id
          this.emitEvent(chatId, { kind: "sessionId", sessionId: rustEvent.session_id })
        }
        break

      case "turnComplete":
        this.emitEvent(chatId, { kind: "turnComplete" })
        break

      default:
        console.warn(`Unknown Gemini event kind: ${rustEvent.kind}`)
    }
  }

  async sendMessage(
    chatId: string,
    prompt: string,
    workingDir: string,
    logDir?: string,
    modelVersion?: string | null,
    permissionMode?: string | null,
    initPrompt?: string
  ): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    chat.workingDir = workingDir

    // Track if this is a new session (for initPrompt injection)
    const isNewSession = !chat.sessionId

    // Stop any existing process first
    await this.stopChat(chatId)
    await this.attachListeners(chatId)
    chat.rateLimitCount = 0 // Reset circuit breaker for new turn

    // Prepend initPrompt to the first message of a new session
    const messageText = isNewSession && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    // Use passed permission mode or fall back to configStore
    const approvalMode = permissionMode ?? configStore.geminiApprovalMode

    console.log(
      `Starting Gemini process [${chatId}] in dir:`,
      workingDir,
      "session:",
      chat.sessionId,
      "approval:",
      approvalMode
    )

    try {
      await backend.invoke("start_gemini_server", {
        serverId: chatId,
        geminiPath: configStore.geminiPath,
        prompt: messageText,
        workingDir,
        sessionId: chat.sessionId ?? null,
        modelVersion: modelVersion ?? null,
        approvalMode: approvalMode ?? null,
        logDir: logDir ?? null,
        logId: chatId,
        agentShell: configStore.agentShell || null,
      })
      chat.running = true
    } catch (err) {
      throw new Error(formatSpawnError(err, configStore.geminiPath))
    }
  }

  /**
   * No-op for Gemini — headless mode doesn't support interactive tool approvals.
   * Use --approval-mode yolo or auto_edit instead.
   */
  async sendToolApproval(
    _chatId: string,
    _requestId: string,
    _approved: boolean,
    _toolInput?: Record<string, unknown>,
    _denyMessage?: string
  ): Promise<void> {
    // No-op: Gemini headless mode doesn't support interactive tool approvals
  }

  async interruptTurn(chatId: string): Promise<void> {
    // Gemini headless mode doesn't have a protocol-level cancel, so interrupt = stop
    await this.stopChat(chatId)
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (chat) {
      chat.running = false
    }
    await backend.invoke("stop_gemini_server", { serverId: chatId })
  }

  isRunning(chatId: string): boolean {
    return this.chats.get(chatId)?.running ?? false
  }

  getSessionId(chatId: string): string | null {
    return this.chats.get(chatId)?.sessionId ?? null
  }

  setSessionId(chatId: string, sessionId: string | null): void {
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

export const geminiAgentService = new GeminiAgentService()
