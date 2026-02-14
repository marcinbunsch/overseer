import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
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
 * Gemini CLI streaming event types (NDJSON format).
 * Note: The CLI uses lowercase event types (init, message, etc.)
 */
interface GeminiStreamEvent {
  type: string
  timestamp?: string
  session_id?: string // CLI uses snake_case
  model?: string
  role?: string
  content?: string
  delta?: boolean
  tool_name?: string // CLI uses snake_case
  tool_id?: string // CLI uses snake_case
  parameters?: Record<string, unknown> // CLI uses "parameters" not "params"
  status?: "success" | "error"
  output?: string // CLI uses "output" for tool results
  error?: string
  message?: string
  code?: string
  success?: boolean
  stats?: Record<string, unknown>
}

interface GeminiChat {
  sessionId: string | null
  running: boolean
  buffer: string
  workingDir: string
  unlistenStdout: UnlistenFn | null
  unlistenStderr: UnlistenFn | null
  unlistenClose: UnlistenFn | null
  /** Count of rate limit retries - used to detect death spirals */
  rateLimitCount: number
  /** True if the last emitted message was an info message (rate limit, etc.) */
  lastWasInfo: boolean
  /** Last tool used (for filtering output) */
  lastToolName: string | null
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
        buffer: "",
        workingDir: "",
        unlistenStdout: null,
        unlistenStderr: null,
        unlistenClose: null,
        rateLimitCount: 0,
        lastWasInfo: false,
        lastToolName: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)

    if (!chat.unlistenStdout) {
      chat.unlistenStdout = await listen<string>(`gemini:stdout:${chatId}`, (event) => {
        const line = event.payload ?? ""
        this.handleOutput(chatId, `${line}\n`)
      })
    }

    if (!chat.unlistenStderr) {
      chat.unlistenStderr = await listen<string>(`gemini:stderr:${chatId}`, (event) => {
        if (event.payload) {
          console.warn(`Gemini stderr [${chatId}]:`, event.payload)
          // Detect quota limit / retry messages and show them as info messages
          const payload = event.payload
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
      chat.unlistenClose = await listen<{ code: number }>(`gemini:close:${chatId}`, () => {
        // Process any remaining buffered content
        if (chat.buffer.trim()) {
          this.parseLine(chatId, chat.buffer.trim())
          chat.buffer = ""
        }
        chat.running = false
        this.emitEvent(chatId, { kind: "turnComplete" })
        this.doneCallbacks.get(chatId)?.()
      })
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
    chat.buffer = ""
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
      await invoke("start_gemini_server", {
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
    await invoke("stop_gemini_server", { serverId: chatId })
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
      chat.unlistenStdout?.()
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

  // --- Private: Output parsing ---

  private handleOutput(chatId: string, data: string): void {
    const chat = this.chats.get(chatId)
    if (!chat) return

    chat.buffer += data
    const lines = chat.buffer.split("\n")
    chat.buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        this.parseLine(chatId, trimmed)
      }
    }
  }

  private parseLine(chatId: string, line: string): void {
    let event: GeminiStreamEvent
    try {
      event = JSON.parse(line) as GeminiStreamEvent
    } catch {
      // Not valid JSON, ignore
      return
    }
    this.translateEvent(chatId, event)
  }

  /**
   * Translate Gemini NDJSON events into generic AgentEvents.
   * Note: Gemini CLI uses lowercase event types and snake_case field names.
   */
  private translateEvent(chatId: string, event: GeminiStreamEvent): void {
    const chat = this.chats.get(chatId)

    // Reset rate limit counter on any successful event (breaks the death spiral detection window)
    if (chat) {
      chat.rateLimitCount = 0
    }

    switch (event.type) {
      case "init":
        // Extract session ID from init event
        if (event.session_id && chat) {
          chat.sessionId = event.session_id
          this.emitEvent(chatId, { kind: "sessionId", sessionId: event.session_id })
        }
        break

      case "message":
        if (event.role === "assistant" && event.content) {
          if (event.delta) {
            // If the last message was an info message (e.g., rate limit), start a new message
            // instead of appending to it via text events
            if (chat?.lastWasInfo) {
              chat.lastWasInfo = false
              this.emitEvent(chatId, { kind: "message", content: event.content })
            } else {
              // Streaming delta — emit as text chunk
              this.emitEvent(chatId, { kind: "text", text: event.content })
            }
          } else {
            // Complete message — emit as message
            this.emitEvent(chatId, { kind: "message", content: event.content })
          }
        }
        break

      case "tool_use":
        if (event.tool_name) {
          const toolName = this.normalizeToolName(event.tool_name)
          const params = event.parameters ?? {}
          const input = JSON.stringify(params, null, 2)
          let toolMeta: ToolMeta | undefined

          // Track last tool name for filtering output
          if (chat) {
            chat.lastToolName = toolName
          }

          // Calculate line changes for Edit-like tools
          if (toolName === "Edit" || toolName === "Write") {
            const oldStr = typeof params.old_string === "string" ? params.old_string : ""
            const newStr =
              typeof params.new_string === "string"
                ? params.new_string
                : typeof params.content === "string"
                  ? params.content
                  : ""
            toolMeta = {
              toolName,
              linesAdded: newStr ? newStr.split("\n").length : 0,
              linesRemoved: oldStr ? oldStr.split("\n").length : 0,
            }
          } else {
            toolMeta = { toolName }
          }

          this.emitEvent(chatId, {
            kind: "message",
            content: input ? `[${toolName}]\n${input}` : `[${toolName}]`,
            toolMeta,
          })
        }
        break

      case "tool_result":
        // Skip emitting file contents for Read tools
        if (chat?.lastToolName === "Read") {
          // Don't emit file contents
        } else if (event.status === "success" && event.output) {
          this.emitEvent(chatId, { kind: "bashOutput", text: event.output })
        } else if (event.status === "error" && event.error) {
          this.emitEvent(chatId, {
            kind: "message",
            content: `Error: ${event.error}`,
          })
        }
        // Reset last tool name after result
        if (chat) {
          chat.lastToolName = null
        }
        break

      case "error":
        if (event.message) {
          console.error(`Gemini error [${chatId}]:`, event.message)
          this.emitEvent(chatId, {
            kind: "message",
            content: `Error: ${event.message}`,
          })
        }
        break

      case "result":
        // Final event with session outcome — turn is complete
        // The close listener will emit turnComplete
        break

      default:
        // Unknown event type — log for debugging
        console.debug(`Gemini event [${chatId}]:`, event.type, event)
        break
    }
  }

  /**
   * Normalize Gemini tool names to match our standard tool names.
   */
  private normalizeToolName(geminiToolName: string): string {
    switch (geminiToolName.toLowerCase()) {
      case "shell":
      case "run_shell_command":
        return "Bash"
      case "write_file":
        return "Write"
      case "edit_file":
        return "Edit"
      case "read_file":
        return "Read"
      case "search":
      case "grep":
        return "Grep"
      case "fetch":
      case "web_fetch":
        return "WebFetch"
      case "list_directory":
        return "ListDir"
      default:
        // Capitalize first letter
        return geminiToolName.charAt(0).toUpperCase() + geminiToolName.slice(1)
    }
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const geminiAgentService = new GeminiAgentService()
