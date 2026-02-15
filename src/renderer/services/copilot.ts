import { backend, type Unsubscribe } from "../backend"
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
 * JSON-RPC message types for the ACP protocol.
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

interface CopilotChat {
  serverId: string
  sessionId: string | null
  running: boolean
  buffer: string
  workingDir: string
  supportsLoadSession: boolean
  unlistenStdout: Unsubscribe | null
  unlistenStderr: Unsubscribe | null
  unlistenClose: Unsubscribe | null
  /** Track active tool calls for status updates */
  activeToolCalls: Map<string, { title: string; kind: string }>
  /** Currently active task for child tool grouping */
  activeTask: { toolCallId: string } | null
}

interface PermissionOption {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

/**
 * CopilotAgentService manages communication with Copilot CLI via the ACP protocol.
 *
 * Architecture:
 * - One `copilot --acp --stdio` process per serverId (chat).
 * - Uses JSON-RPC 2.0 over stdio for communication.
 * - Translates ACP session/update notifications into AgentEvents.
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
        buffer: "",
        workingDir: "",
        supportsLoadSession: false,
        unlistenStdout: null,
        unlistenStderr: null,
        unlistenClose: null,
        activeToolCalls: new Map(),
        activeTask: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    const serverId = chat.serverId

    if (!chat.unlistenStdout) {
      chat.unlistenStdout = await backend.listen<string>(
        `copilot:stdout:${serverId}`,
        (payload) => {
          const line = payload ?? ""
          this.handleOutput(chatId, `${line}\n`)
        }
      )
    }

    if (!chat.unlistenStderr) {
      chat.unlistenStderr = await backend.listen<string>(
        `copilot:stderr:${serverId}`,
        (payload) => {
          const line = payload ?? ""
          console.warn(`Copilot stderr [${chatId}]:`, line)
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
      // Clear stale session ID from a previous server session
      chat.sessionId = null

      console.log(`Starting Copilot ACP server [${chatId}]`)
      try {
        await backend.invoke("start_copilot_server", {
          serverId: chat.serverId,
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

    // Server-initiated request (has id + method) — permission requests
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

    if (req.method === "session/request_permission") {
      // Copilot permission request structure:
      // params.toolCall: { toolCallId, title, kind, status, rawInput }
      // params.options: [{ optionId, kind, name }]
      const toolCall =
        (params.toolCall as {
          toolCallId?: string
          title?: string
          kind?: string
          rawInput?: Record<string, unknown>
        }) ?? {}
      const options = (params.options as PermissionOption[]) ?? []

      const title = toolCall.title ?? "Permission"
      const kind = toolCall.kind ?? "other"
      const rawInput = toolCall.rawInput ?? {}

      // Convert kind to tool name
      const toolName = this.kindToToolName(kind, title)

      // Extract command prefixes for Bash approvals (handles chained commands)
      let commandPrefixes: string[] | undefined
      if (toolName === "Bash" && rawInput.command) {
        commandPrefixes = getCommandPrefixes({ command: rawInput.command })
      }

      // Build display input based on tool type
      let displayInput: string
      if (toolName === "Bash" && rawInput.command) {
        displayInput = rawInput.command as string
      } else if (rawInput.url) {
        displayInput = rawInput.url as string
      } else if (rawInput.path) {
        displayInput = rawInput.path as string
      } else {
        displayInput = JSON.stringify(rawInput, null, 2)
      }

      this.emitEvent(chatId, {
        kind: "toolApproval",
        id: String(req.id),
        name: toolName,
        input: rawInput,
        displayInput,
        commandPrefixes,
        // Include options for potential future use (allow_always support)
        options: options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
      })
      return
    }

    // Unknown server request — log it
    console.warn(`Unknown copilot server request: ${req.method}`, req)
  }

  private handleNotification(chatId: string, notif: JsonRpcNotification): void {
    const params = notif.params ?? {}
    const chat = this.chats.get(chatId)

    if (notif.method === "session/update") {
      // ACP nests update data under params.update, with sessionUpdate as the type field
      const update = (params.update as Record<string, unknown>) ?? params
      const updateType = (update.sessionUpdate as string) ?? (params.type as string)

      switch (updateType) {
        case "agent_message_chunk": {
          const content = update.content as { type: string; text?: string } | undefined
          if (content?.type === "text" && content.text) {
            this.emitEvent(chatId, { kind: "text", text: content.text })
          }
          break
        }

        case "agent_thought_chunk": {
          // Thinking/reasoning - emit as text
          const content = update.content as { type: string; text?: string } | undefined
          if (content?.type === "text" && content.text) {
            this.emitEvent(chatId, { kind: "text", text: content.text })
          }
          break
        }

        case "tool_call": {
          // New tool call started
          const toolCallId = update.toolCallId as string
          const title = (update.title as string) ?? "Tool"
          const kind = (update.kind as string) ?? "other"
          const status = update.status as string
          const input = (update.rawInput ?? update.input) as Record<string, unknown> | undefined

          if (chat) {
            chat.activeToolCalls.set(toolCallId, { title, kind })
          }

          if (status === "pending" || status === "in_progress") {
            // Check if this is a Task (has agent_type in input)
            const isTask = input && typeof input.agent_type === "string"

            if (isTask) {
              // This is a Task - track it and emit with toolUseId
              if (chat) {
                chat.activeTask = { toolCallId }
              }

              // Transform input: rename agent_type -> subagent_type for TaskToolItem
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { agent_type, ...rest } = input
              const transformedInput = {
                ...rest,
                subagent_type: agent_type,
              }

              const inputStr = JSON.stringify(transformedInput, null, 2)
              this.emitEvent(chatId, {
                kind: "message",
                content: `[Task]\n${inputStr}`,
                toolMeta: { toolName: "Task" },
                toolUseId: toolCallId,
              })
            } else {
              // Regular tool - may be a child of an active Task
              const toolName = this.kindToToolName(kind, title)
              const inputStr = input ? JSON.stringify(input, null, 2) : ""
              const parentToolUseId = chat?.activeTask?.toolCallId ?? undefined
              this.emitEvent(chatId, {
                kind: "message",
                content: inputStr ? `[${toolName}]\n${inputStr}` : `[${toolName}]`,
                toolMeta: { toolName },
                parentToolUseId,
              })
            }
          }
          break
        }

        case "tool_call_update": {
          const toolCallId = update.toolCallId as string
          const status = update.status as string
          const output = (update.rawOutput ?? update.output) as Record<string, unknown> | undefined
          const content = update.content as
            | Array<{ type: string; [key: string]: unknown }>
            | undefined

          // Get the tool info to know how to handle output
          const toolInfo = chat?.activeToolCalls.get(toolCallId)

          if (status === "completed") {
            // Handle Read tool output specially - it has content + detailedContent
            // For Read tools, we don't emit the file content to chat since
            // the filename is already shown in the tool call message
            if (toolInfo?.kind === "read" && output) {
              // Skip emitting file content - just mark tool as complete
              // The user can see what was read from the tool call itself
            } else if (content) {
              // Handle tool output/content array
              for (const item of content) {
                if (item.type === "text" && item.text) {
                  this.emitEvent(chatId, { kind: "bashOutput", text: item.text as string })
                } else if (item.type === "terminal_output" && item.output) {
                  this.emitEvent(chatId, { kind: "bashOutput", text: item.output as string })
                } else if (item.type === "diff") {
                  // File diff - emit as message
                  const path = (item.path as string) ?? ""
                  const diff = (item.diff as string) ?? ""
                  this.emitEvent(chatId, {
                    kind: "message",
                    content: `[Edit]\n${JSON.stringify({ file_path: path, diff }, null, 2)}`,
                    toolMeta: { toolName: "Edit" },
                  })
                }
              }
            } else if (output) {
              // Other tool output - stringify but skip detailedContent if present
              const cleanOutput = { ...output }
              delete cleanOutput.detailedContent
              const outputStr = JSON.stringify(cleanOutput, null, 2)
              this.emitEvent(chatId, { kind: "bashOutput", text: outputStr })
            }

            if (chat) {
              chat.activeToolCalls.delete(toolCallId)
              // Clear active task if this was the task completing
              if (chat.activeTask?.toolCallId === toolCallId) {
                chat.activeTask = null
              }
            }
          }
          break
        }

        case "plan": {
          // Plan mode - emit as message
          const steps = update.steps as Array<{ description: string; status: string }> | undefined
          if (steps && steps.length > 0) {
            const planText = steps
              .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
              .join("\n")
            this.emitEvent(chatId, {
              kind: "message",
              content: `Plan:\n${planText}`,
            })
          }
          break
        }

        case "user_message_chunk":
          // Echo of user message - ignore
          break

        case "available_commands_update":
        case "current_mode_update":
          // Informational - ignore
          break

        default:
          console.debug(`Copilot session/update [${chatId}]:`, updateType, update)
          break
      }
      return
    }

    // Handle other notifications
    switch (notif.method) {
      case "$/progress":
      case "$/cancelRequest":
        // Protocol-level notifications - ignore
        break

      default:
        console.debug(`Copilot notification [${chatId}]:`, notif.method, params)
        break
    }
  }

  private kindToToolName(kind: string, title: string): string {
    switch (kind) {
      case "execute":
        return "Bash"
      case "edit":
        return "Edit"
      case "read":
        return "Read"
      case "search":
        return "Grep"
      case "fetch":
        return "WebFetch"
      case "think":
        return "Think"
      default:
        return title
    }
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const copilotAgentService = new CopilotAgentService()
