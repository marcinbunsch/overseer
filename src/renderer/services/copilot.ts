import { backend, type Unsubscribe } from "../backend"
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
function formatSpawnError(error: unknown, copilotPath: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  if (isCommandNotFoundError(errorStr)) {
    toolAvailabilityStore.markUnavailable("copilot", errorStr)

    return `Copilot CLI not found at "${copilotPath}".

To fix this:
1. Install GitHub Copilot CLI from https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli
2. Or update the path in ~/.config/overseer/config.json

Current path: ${copilotPath}`
  }

  return errorStr
}

/**
 * JSON-RPC response type for handling client request responses.
 * This is the only message type we parse in TypeScript - notifications
 * and server requests are parsed in Rust.
 */
interface JsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * AgentEvent from Rust (matches overseer-core AgentEvent enum).
 *
 * Rust uses `#[serde(tag = "kind", rename_all = "camelCase")]` which produces
 * internally tagged enums: `{"kind": "text", "text": "Hello"}`
 */
interface RustAgentEvent {
  kind: string
  // Text variant
  text?: string
  // Message variant
  content?: string
  tool_meta?: { tool_name: string; lines_added?: number; lines_removed?: number }
  parent_tool_use_id?: string
  tool_use_id?: string
  is_info?: boolean
  // ToolApproval variant
  request_id?: string
  name?: string
  input?: Record<string, unknown>
  display_input?: string
  prefixes?: string[]
  auto_approved?: boolean
  // SessionId variant
  session_id?: string
}

interface CopilotChat {
  serverId: string
  sessionId: string | null
  running: boolean
  workingDir: string
  supportsLoadSession: boolean
  unlistenStdout: Unsubscribe | null
  unlistenEvent: Unsubscribe | null
  unlistenClose: Unsubscribe | null
}

/**
 * CopilotAgentService manages communication with Copilot CLI via the ACP protocol.
 *
 * Architecture:
 * - One `copilot --acp --stdio` process per serverId (chat).
 * - Rust handles protocol parsing and emits typed AgentEvents.
 * - TypeScript only handles JSON-RPC responses for client-initiated requests (initialize, session/new, session/prompt).
 */
class CopilotAgentService implements AgentService {
  private chats: Map<string, CopilotChat> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()
  private nextId: number = 1
  /** Track pending responses keyed by request id. */
  private pendingResponses: Map<
    number,
    { chatId: string; resolve: (result: unknown) => void; reject: (err: Error) => void }
  > = new Map()

  private getOrCreateChat(chatId: string): CopilotChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = {
        serverId: chatId,
        sessionId: null,
        running: false,
        workingDir: "",
        supportsLoadSession: false,
        unlistenStdout: null,
        unlistenEvent: null,
        unlistenClose: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    const serverId = chat.serverId

    // Listen for raw stdout to handle JSON-RPC responses to our requests
    if (!chat.unlistenStdout) {
      chat.unlistenStdout = await backend.listen<string>(
        `copilot:stdout:${serverId}`,
        (payload) => {
          const line = payload ?? ""
          this.handleResponseLine(chatId, line)
        }
      )
    }

    // Listen for pre-parsed events from Rust
    if (!chat.unlistenEvent) {
      chat.unlistenEvent = await backend.listen<RustAgentEvent>(
        `copilot:event:${serverId}`,
        (payload) => {
          this.handleRustEvent(chatId, payload)
        }
      )
    }

    if (!chat.unlistenClose) {
      chat.unlistenClose = await backend.listen<{ code: number }>(
        `copilot:close:${serverId}`,
        () => {
          chat.running = false
          this.doneCallbacks.get(chatId)?.()
        }
      )
    }
  }

  async sendMessage(
    chatId: string,
    prompt: string,
    workingDir: string,
    logDir?: string,
    modelVersion?: string | null,
    _permissionMode?: string | null,
    initPrompt?: string,
    projectName?: string
  ): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    chat.workingDir = workingDir

    // Track if this is a new session (for initPrompt injection)
    const isNewSession = !chat.running

    // Start server if not running
    if (!chat.running) {
      await this.attachListeners(chatId)
      // Clear stale session ID from a previous server session
      chat.sessionId = null

      console.log(`Starting Copilot ACP server [${chatId}]`)
      try {
        await backend.invoke("start_copilot_server", {
          serverId: chat.serverId,
          projectName: projectName ?? "default",
          copilotPath: configStore.copilotPath,
          modelVersion: modelVersion ?? null,
          logDir: logDir ?? null,
          logId: chatId,
          agentShell: configStore.agentShell || null,
        })
      } catch (err) {
        throw new Error(formatSpawnError(err, configStore.copilotPath))
      }
      chat.running = true

      // Perform ACP initialize handshake
      const initResult = (await this.sendRequest(chatId, "initialize", {
        protocolVersion: 1,
        clientInfo: { name: "overseer", title: "Overseer", version: "1.0.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      })) as {
        agentCapabilities?: { loadSession?: boolean }
      }

      chat.supportsLoadSession = initResult?.agentCapabilities?.loadSession ?? false
    }

    // Create or load session if needed
    if (!chat.sessionId) {
      const result = (await this.sendRequest(chatId, "session/new", {
        cwd: workingDir,
        mcpServers: [],
      })) as { sessionId?: string }

      const sessionId = result?.sessionId
      if (sessionId) {
        chat.sessionId = sessionId
        this.emitEvent(chatId, { kind: "sessionId", sessionId })
      }
    }

    // Prepend initPrompt to the first message of a new session
    const messageText = isNewSession && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    // Send the prompt - response will come when turn completes
    // Note: ACP uses "prompt" field (array), not "content"
    await this.sendRequest(chatId, "session/prompt", {
      sessionId: chat.sessionId,
      prompt: [{ type: "text", text: messageText }],
    })

    // Turn completed
    this.emitEvent(chatId, { kind: "turnComplete" })
  }

  async sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    _toolInput?: Record<string, unknown>, // eslint-disable-line @typescript-eslint/no-unused-vars
    _denyMessage?: string // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    // Respond to the server-initiated permission request.
    // ACP RequestPermissionResponse uses outcome: { outcome: "selected", optionId } or { outcome: "cancelled" }
    const optionId = approved ? "allow_once" : "reject_once"
    const parsedId = /^\d+$/.test(requestId) ? Number(requestId) : requestId
    // JSON-RPC 2.0 responses MUST include the "jsonrpc" field
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: parsedId,
      result: { outcome: { outcome: "selected", optionId } },
    })
    const chat = this.chats.get(chatId)
    if (!chat) return

    console.log(`Sending permission response [${chatId}]:`, response)
    await backend.invoke("copilot_stdin", {
      serverId: chat.serverId,
      data: response,
    })
  }

  async interruptTurn(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat?.sessionId) return

    // Send cancel notification - don't kill server to preserve session context
    this.sendNotification(chatId, "session/cancel", { sessionId: chat.sessionId })
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat) return

    // Interrupt any running turn first
    await this.interruptTurn(chatId)

    chat.running = false
    await backend.invoke("stop_copilot_server", { serverId: chat.serverId })
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
      chat.unlistenEvent?.()
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

  // --- Private: JSON-RPC communication ---

  private async sendRequest(
    chatId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const chat = this.chats.get(chatId)
    if (!chat) throw new Error(`No chat for ${chatId}`)

    const id = this.nextId++
    const msg = JSON.stringify({ jsonrpc: "2.0", method, id, params })

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { chatId, resolve, reject })
      backend.invoke("copilot_stdin", { serverId: chat.serverId, data: msg }).catch(reject)
    })
  }

  private sendNotification(chatId: string, method: string, params: Record<string, unknown>): void {
    const chat = this.chats.get(chatId)
    if (!chat) return

    const msg = JSON.stringify({ jsonrpc: "2.0", method, params })
    backend.invoke("copilot_stdin", { serverId: chat.serverId, data: msg }).catch((err) => {
      console.warn(`Failed to send copilot notification [${chatId}]:`, err)
    })
  }

  // --- Private: Event handling ---

  /**
   * Handle raw stdout lines - only for JSON-RPC responses to our requests.
   * All other parsing is done in Rust.
   */
  private handleResponseLine(_chatId: string, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: unknown
    try {
      msg = JSON.parse(trimmed)
    } catch {
      return // Not valid JSON, ignore
    }

    // Only handle responses (has id, no method)
    if (typeof msg === "object" && msg !== null && "id" in msg && !("method" in msg)) {
      const resp = msg as JsonRpcResponse
      const id = typeof resp.id === "number" ? resp.id : parseInt(String(resp.id), 10)
      const pending = this.pendingResponses.get(id)
      if (pending) {
        this.pendingResponses.delete(id)
        if (resp.error) {
          pending.reject(new Error(resp.error.message))
        } else {
          pending.resolve(resp.result)
        }
      }
    }
  }

  /**
   * Handle pre-parsed events from Rust.
   * Translates Rust AgentEvent enum to TypeScript AgentEvent.
   *
   * Rust uses internally tagged enums: {"kind": "text", "text": "Hello"}
   */
  private handleRustEvent(chatId: string, event: RustAgentEvent): void {
    switch (event.kind) {
      case "text":
        if (event.text !== undefined) {
          this.emitEvent(chatId, { kind: "text", text: event.text })
        }
        break

      case "message":
        if (event.content !== undefined) {
          this.emitEvent(chatId, {
            kind: "message",
            content: event.content,
            toolMeta: event.tool_meta
              ? {
                  toolName: event.tool_meta.tool_name,
                  linesAdded: event.tool_meta.lines_added,
                  linesRemoved: event.tool_meta.lines_removed,
                }
              : undefined,
            parentToolUseId: event.parent_tool_use_id,
            toolUseId: event.tool_use_id,
            isInfo: event.is_info,
          })
        }
        break

      case "bashOutput":
        if (event.text !== undefined) {
          this.emitEvent(chatId, { kind: "bashOutput", text: event.text })
        }
        break

      case "toolApproval":
        // Skip auto-approved tools (Rust already handled them)
        if (event.auto_approved) {
          return
        }
        this.emitEvent(chatId, {
          kind: "toolApproval",
          id: event.request_id ?? "",
          name: event.name ?? "",
          input: event.input ?? {},
          displayInput: event.display_input ?? "",
          commandPrefixes: event.prefixes,
        })
        break

      case "turnComplete":
        this.emitEvent(chatId, { kind: "turnComplete" })
        break

      case "sessionId":
        if (event.session_id !== undefined) {
          this.emitEvent(chatId, { kind: "sessionId", sessionId: event.session_id })
        }
        break

      default:
        console.warn(`Unknown Copilot event kind: ${event.kind}`)
    }
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const copilotAgentService = new CopilotAgentService()
