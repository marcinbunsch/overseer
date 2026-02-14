import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { AgentService, AgentEventCallback, AgentDoneCallback, AgentEvent } from "./types"
import { getCommandPrefixes } from "../types"
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
function formatSpawnError(error: unknown, codexPath: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  if (isCommandNotFoundError(errorStr)) {
    // Update tool availability store
    toolAvailabilityStore.markUnavailable("codex", errorStr)

    return `Codex CLI not found at "${codexPath}".

To fix this:
1. Install Codex from https://codex.openai.com
2. Or update the path in ~/.config/overseer/config.json

Current path: ${codexPath}`
  }

  // Return original error for other failures
  return errorStr
}

/**
 * Lightweight JSON-RPC message types for the Codex app-server protocol.
 * We only define the shapes we actually need to parse/send.
 */
interface JsonRpcNotification {
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcServerRequest {
  method: string
  id: number | string
  params?: Record<string, unknown>
}

type JsonRpcMessage = JsonRpcNotification | JsonRpcResponse | JsonRpcServerRequest

interface CodexChat {
  serverId: string
  threadId: string | null
  running: boolean
  buffer: string
  workingDir: string
  unlistenStdout: UnlistenFn | null
  unlistenClose: UnlistenFn | null
  /** Track whether we're currently streaming command output */
  inCommandExecution: boolean
}

/**
 * CodexAgentService manages communication with Codex's `app-server` JSON-RPC process.
 *
 * Architecture:
 * - One `codex app-server` process per serverId (workspace).
 * - Multiple chats (threads) can share a server, but currently we use one server per chat
 *   keyed by chatId for simplicity (since each chat can target a different cwd).
 * - The service handles the initialize handshake, thread creation, and translates
 *   Codex JSON-RPC notifications into AgentEvents.
 */
class CodexAgentService implements AgentService {
  private chats: Map<string, CodexChat> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()
  private nextId: number = 1
  /** Track pending responses keyed by request id. */
  private pendingResponses: Map<
    number,
    { chatId: string; resolve: (result: unknown) => void; reject: (err: Error) => void }
  > = new Map()

  private getOrCreateChat(chatId: string): CodexChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = {
        serverId: chatId,
        threadId: null,
        running: false,
        buffer: "",
        workingDir: "",
        unlistenStdout: null,
        unlistenClose: null,
        inCommandExecution: false,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    const serverId = chat.serverId

    if (!chat.unlistenStdout) {
      chat.unlistenStdout = await listen<string>(`codex:stdout:${serverId}`, (event) => {
        const line = event.payload ?? ""
        this.handleOutput(chatId, `${line}\n`)
      })
    }

    if (!chat.unlistenClose) {
      chat.unlistenClose = await listen<{ code: number }>(`codex:close:${serverId}`, () => {
        chat.running = false
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
    const isNewSession = !chat.running

    // Start server if not running
    if (!chat.running) {
      await this.attachListeners(chatId)
      chat.buffer = ""
      // Clear stale thread ID from a previous server session
      chat.threadId = null

      console.log(`Starting Codex app-server [${chatId}]`)
      try {
        await invoke("start_codex_server", {
          serverId: chat.serverId,
          codexPath: configStore.codexPath,
          modelVersion: modelVersion ?? null,
          logDir: logDir ?? null,
          logId: chatId,
        })
      } catch (err) {
        // Re-throw with a more helpful error message
        throw new Error(formatSpawnError(err, configStore.codexPath))
      }
      chat.running = true

      // Perform initialize handshake
      await this.sendRequest(chatId, "initialize", {
        clientInfo: { name: "overseer", title: "Overseer", version: "1.0.0" },
      })
      // Send initialized notification (no response expected)
      this.sendNotification(chatId, "initialized", {})
    }

    // Use passed permission mode or fall back to configStore
    const approvalPolicy = permissionMode ?? configStore.codexApprovalPolicy

    // If no thread yet, create one
    if (!chat.threadId) {
      const result = (await this.sendRequest(chatId, "thread/start", {
        cwd: workingDir,
        approvalPolicy,
        sandbox: "workspace-write",
      })) as { thread?: { id?: string } }

      const threadId = result?.thread?.id
      if (threadId) {
        chat.threadId = threadId
        this.emitEvent(chatId, { kind: "sessionId", sessionId: threadId })
      }
    }

    // Prepend initPrompt to the first message of a new session
    const messageText = isNewSession && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    // Send the turn
    await this.sendRequest(chatId, "turn/start", {
      threadId: chat.threadId,
      input: [{ type: "text", text: messageText }],
      cwd: workingDir,
      approvalPolicy,
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [workingDir],
        networkAccess: true,
      },
    })
  }

  async sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    _toolInput?: Record<string, unknown>, // eslint-disable-line @typescript-eslint/no-unused-vars
    _denyMessage?: string // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    // Respond to the server-initiated request.
    // JSON-RPC requires the response id to match the request id type exactly.
    // The id was stringified when emitting the event, so parse it back to a
    // number if it was originally numeric.
    const decision = approved ? "accept" : "decline"
    const parsedId = /^\d+$/.test(requestId) ? Number(requestId) : requestId
    const response = JSON.stringify({
      id: parsedId,
      result: { decision },
    })
    const chat = this.chats.get(chatId)
    if (!chat) return

    console.log(`Sending approval response [${chatId}]:`, response)
    await invoke("codex_stdin", {
      serverId: chat.serverId,
      data: response,
    })
  }

  async interruptTurn(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat?.threadId) return

    // Send interrupt notification - don't kill server to preserve thread context
    this.sendNotification(chatId, "turn/interrupt", { threadId: chat.threadId })
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat) return

    // Interrupt any running turn first
    await this.interruptTurn(chatId)

    chat.running = false
    await invoke("stop_codex_server", { serverId: chat.serverId })
  }

  isRunning(chatId: string): boolean {
    return this.chats.get(chatId)?.running ?? false
  }

  getSessionId(chatId: string): string | null {
    return this.chats.get(chatId)?.threadId ?? null
  }

  setSessionId(chatId: string, sessionId: string | null): void {
    const chat = this.getOrCreateChat(chatId)
    chat.threadId = sessionId
  }

  removeChat(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (chat) {
      chat.unlistenStdout?.()
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
    const msg = JSON.stringify({ method, id, params })

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { chatId, resolve, reject })
      invoke("codex_stdin", { serverId: chat.serverId, data: msg }).catch(reject)
    })
  }

  private sendNotification(chatId: string, method: string, params: Record<string, unknown>): void {
    const chat = this.chats.get(chatId)
    if (!chat) return

    const msg = JSON.stringify({ method, params })
    invoke("codex_stdin", { serverId: chat.serverId, data: msg }).catch((err) => {
      console.warn(`Failed to send codex notification [${chatId}]:`, err)
    })
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
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line) as JsonRpcMessage
    } catch {
      // Not valid JSON, ignore
      return
    }
    this.handleMessage(chatId, msg)
  }

  private handleMessage(chatId: string, msg: JsonRpcMessage): void {
    // Response to a client request (has id + result/error, no method)
    if ("id" in msg && !("method" in msg)) {
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
      return
    }

    // Server-initiated request (has id + method) — approval requests
    if ("id" in msg && "method" in msg) {
      this.handleServerRequest(chatId, msg as JsonRpcServerRequest)
      return
    }

    // Notification (method, no id)
    if ("method" in msg) {
      this.handleNotification(chatId, msg as JsonRpcNotification)
      return
    }
  }

  private handleServerRequest(chatId: string, req: JsonRpcServerRequest): void {
    const params = req.params ?? {}

    if (req.method === "item/commandExecution/requestApproval") {
      const command = (params.command as string) ?? ""
      this.emitEvent(chatId, {
        kind: "toolApproval",
        id: String(req.id),
        name: "Bash",
        input: params,
        displayInput: command,
        commandPrefixes: getCommandPrefixes({ command }),
      })
      return
    }

    if (req.method === "item/fileChange/requestApproval") {
      this.emitEvent(chatId, {
        kind: "toolApproval",
        id: String(req.id),
        name: "Edit",
        input: params,
        displayInput: JSON.stringify(params, null, 2),
      })
      return
    }

    if (req.method === "item/tool/requestUserInput") {
      // Map to a question event if possible, otherwise treat as tool approval
      this.emitEvent(chatId, {
        kind: "toolApproval",
        id: String(req.id),
        name: "UserInput",
        input: params,
        displayInput: JSON.stringify(params, null, 2),
      })
      return
    }

    // Unknown server request — auto-accept to avoid blocking
    console.warn(`Unknown codex server request: ${req.method}`, req)
    const response = JSON.stringify({ id: req.id, result: { decision: "accept" } })
    const chat = this.chats.get(chatId)
    if (chat) {
      invoke("codex_stdin", { serverId: chat.serverId, data: response }).catch(() => {})
    }
  }

  private handleNotification(chatId: string, notif: JsonRpcNotification): void {
    const params = notif.params ?? {}

    switch (notif.method) {
      case "item/agentMessage/delta": {
        const delta = params.delta as string | undefined
        if (delta) {
          this.emitEvent(chatId, { kind: "text", text: delta })
        }
        break
      }

      case "item/started": {
        const chat = this.chats.get(chatId)
        const item = params.item as Record<string, unknown> | undefined
        if (!item) break
        const type = item.type as string

        if (type === "commandExecution") {
          if (chat) chat.inCommandExecution = true
          const command = (item.command as string) ?? ""
          const input = JSON.stringify({ command }, null, 2)
          this.emitEvent(chatId, {
            kind: "message",
            content: `[Bash]\n${input}`,
            toolMeta: { toolName: "Bash" },
          })
        } else if (type === "fileChange") {
          const diff = (item.diff as string) ?? ""
          const filePath = (item.filePath as string) ?? ""
          const input = JSON.stringify(
            { file_path: filePath, old_string: "", new_string: diff },
            null,
            2
          )
          this.emitEvent(chatId, {
            kind: "message",
            content: `[Edit]\n${input}`,
            toolMeta: { toolName: "Edit" },
          })
        } else if (type === "mcpToolCall") {
          const toolName = (item.toolName as string) ?? "Tool"
          const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : ""
          this.emitEvent(chatId, {
            kind: "message",
            content: args ? `[${toolName}]\n${args}` : `[${toolName}]`,
          })
        }
        break
      }

      case "item/completed": {
        const chat = this.chats.get(chatId)
        const item = params.item as Record<string, unknown> | undefined
        if (!item) break
        const type = item.type as string

        if (type === "commandExecution") {
          if (chat) chat.inCommandExecution = false
        } else if (type === "agentMessage") {
          const text = (item.text as string) ?? ""
          if (text) {
            this.emitEvent(chatId, { kind: "message", content: text })
          }
        }
        break
      }

      case "turn/completed":
        this.emitEvent(chatId, { kind: "turnComplete" })
        break

      case "item/commandExecution/outputDelta": {
        // Command output streaming — emit as bashOutput for collapsible rendering
        const delta = params.delta as string | undefined
        if (delta) {
          this.emitEvent(chatId, { kind: "bashOutput", text: delta })
        }
        break
      }

      case "item/reasoning/summaryTextDelta": {
        const delta = params.delta as string | undefined
        if (delta) {
          this.emitEvent(chatId, { kind: "text", text: delta })
        }
        break
      }

      case "thread/name/updated":
      case "thread/tokenUsage/updated":
      case "thread/compacted":
      case "account/updated":
      case "account/rateLimits/updated":
      case "deprecationNotice":
        // Informational — ignore
        break

      case "error": {
        const message = (params.message as string) ?? "Unknown error"
        console.error(`Codex error [${chatId}]:`, message)
        this.emitEvent(chatId, {
          kind: "message",
          content: `Error: ${message}`,
        })
        break
      }

      default:
        // Unknown notification — log for debugging
        console.debug(`Codex notification [${chatId}]:`, notif.method, params)
        break
    }
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const codexAgentService = new CodexAgentService()
