import { backend, type Unsubscribe } from "../backend"
import type { AgentService, AgentEventCallback, AgentDoneCallback, AgentEvent } from "./types"
import { configStore } from "../stores/ConfigStore"
import { codexUsageStore, type CodexUsageData } from "../stores/CodexUsageStore"
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
 * JSON-RPC response type for handling client request responses.
 * This is the only message type we parse in TypeScript - notifications
 * and server requests are parsed in Rust.
 */
interface JsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcNotification {
  method: string
  params?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseUsageWindow(value: unknown): CodexUsageData["primary"] {
  if (
    !isRecord(value) ||
    typeof value.usedPercent !== "number" ||
    !Number.isFinite(value.usedPercent)
  ) {
    return null
  }

  return {
    usedPercent: value.usedPercent,
    windowDurationMins:
      typeof value.windowDurationMins === "number" && Number.isFinite(value.windowDurationMins)
        ? value.windowDurationMins
        : null,
    resetsAt:
      typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt) ? value.resetsAt : null,
  }
}

function parseUsageData(value: unknown): CodexUsageData | null {
  if (!isRecord(value)) return null

  return {
    limitId: typeof value.limitId === "string" ? value.limitId : null,
    limitName: typeof value.limitName === "string" ? value.limitName : null,
    primary: parseUsageWindow(value.primary),
    secondary: parseUsageWindow(value.secondary),
    credits: isRecord(value.credits)
      ? {
          hasCredits: value.credits.hasCredits === true,
          unlimited: value.credits.unlimited === true,
          balance: typeof value.credits.balance === "string" ? value.credits.balance : null,
        }
      : null,
    planType: typeof value.planType === "string" ? value.planType : null,
  }
}

function parseRateLimitNotification(value: unknown): CodexUsageData | null {
  if (!isRecord(value)) return null
  return parseUsageData(value.rateLimits)
}

function parseRateLimitResponse(value: unknown): CodexUsageData | null {
  if (!isRecord(value)) return null
  return parseUsageData(value.rateLimits)
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
  is_processed?: boolean
  // SessionId variant
  session_id?: string
}

interface CodexChat {
  serverId: string
  threadId: string | null
  /** Id of the in-flight turn, set on turn/started and cleared on turn/completed. */
  turnId: string | null
  running: boolean
  workingDir: string
  /**
   * Shared git dir (`git rev-parse --git-common-dir`), resolved once and cached.
   * `null` means not resolved yet; `""` means resolution failed (don't retry).
   * Added to the sandbox writable roots so `git commit` works inside a worktree,
   * whose `.git` state lives outside the workspace directory.
   */
  gitCommonDir: string | null
  unlistenStdout: Unsubscribe | null
  unlistenEvent: Unsubscribe | null
  unlistenClose: Unsubscribe | null
}

/**
 * CodexAgentService manages communication with Codex's `app-server` JSON-RPC process.
 *
 * Architecture:
 * - One `codex app-server` process per serverId (workspace).
 * - Multiple chats (threads) can share a server, but currently we use one server per chat
 *   keyed by chatId for simplicity (since each chat can target a different cwd).
 * - Rust handles protocol parsing and emits typed AgentEvents.
 * - TypeScript only handles JSON-RPC responses for client-initiated requests (initialize, thread/start, thread/resume, turn/start).
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
        turnId: null,
        running: false,
        workingDir: "",
        gitCommonDir: null,
        unlistenStdout: null,
        unlistenEvent: null,
        unlistenClose: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  async attachListeners(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    const serverId = chat.serverId

    // Listen for raw stdout to handle JSON-RPC responses to our requests
    if (!chat.unlistenStdout) {
      chat.unlistenStdout = await backend.listen<string>(`codex:stdout:${serverId}`, (payload) => {
        const line = payload ?? ""
        this.handleResponseLine(chatId, line)
      })
    }

    // Listen for pre-parsed events from Rust
    if (!chat.unlistenEvent) {
      chat.unlistenEvent = await backend.listen<RustAgentEvent>(
        `codex:event:${serverId}`,
        (payload) => {
          this.handleRustEvent(chatId, payload)
        }
      )
    }

    if (!chat.unlistenClose) {
      chat.unlistenClose = await backend.listen<{ code: number }>(`codex:close:${serverId}`, () => {
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
    initPrompt?: string,
    projectName?: string,
    // effortLevel (9) and claudeConfigDir (11) are Claude-only; Codex ignores
    // them but keeps them in the signature to match the AgentService interface.
    _effortLevel?: string | null, // eslint-disable-line @typescript-eslint/no-unused-vars
    sandboxed?: boolean,
    _claudeConfigDir?: string // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    chat.workingDir = workingDir
    const isSandboxed = sandboxed ?? false
    const sandboxMode = isSandboxed ? "workspace-write" : "danger-full-access"

    // Was the app-server already up? Used to decide whether we need to resume a
    // persisted thread after a (re)start.
    const serverWasRunning = chat.running

    // Start server if not running
    if (!chat.running) {
      await this.attachListeners(chatId)
      // Keep a persisted thread id — we resume it below instead of dropping it.

      console.log(`Starting Codex app-server [${chatId}]`)
      try {
        await backend.invoke("start_codex_server", {
          serverId: chat.serverId,
          projectName: projectName ?? "default",
          codexPath: configStore.codexPath,
          modelVersion: modelVersion ?? null,
          logDir: logDir ?? null,
          logId: chatId,
          agentShell: configStore.agentShell || null,
          workingDir,
          sandboxed: isSandboxed,
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
      void this.fetchRateLimits(chatId).catch((error) => {
        console.warn(`Failed to read Codex rate limits [${chatId}]:`, error)
      })
    }

    // Use passed permission mode or fall back to configStore
    const approvalPolicy = permissionMode ?? configStore.codexApprovalPolicy

    // Resume a persisted thread after the server was (re)started. The thread
    // lives on disk (rollout), so thread/resume reloads its context. On a
    // running server the thread is already live, so we skip this.
    if (!serverWasRunning && chat.threadId) {
      try {
        const result = (await this.sendRequest(chatId, "thread/resume", {
          threadId: chat.threadId,
          cwd: workingDir,
          approvalPolicy,
          sandbox: sandboxMode,
        })) as { thread?: { id?: string } }

        const resumedId = result?.thread?.id
        if (resumedId) {
          chat.threadId = resumedId
          this.emitEvent(chatId, { kind: "sessionId", sessionId: resumedId })
        }
      } catch (err) {
        // The rollout for this thread is gone — start a fresh one and tell the user.
        console.warn(`Failed to resume Codex thread [${chatId}]:`, err)
        chat.threadId = null
        this.emitEvent(chatId, {
          kind: "message",
          content: "Couldn't restore the previous Codex session; starting a new one.",
          isInfo: true,
        })
      }
    }

    // Track whether we create a brand-new thread — initPrompt only belongs on a
    // fresh thread, not a resumed one (which already carries that context).
    let startedNewThread = false

    // If no thread yet, create one
    if (!chat.threadId) {
      const result = (await this.sendRequest(chatId, "thread/start", {
        cwd: workingDir,
        approvalPolicy,
        sandbox: sandboxMode,
      })) as { thread?: { id?: string } }

      const threadId = result?.thread?.id
      if (threadId) {
        chat.threadId = threadId
        startedNewThread = true
        this.emitEvent(chatId, { kind: "sessionId", sessionId: threadId })
      }
    }

    // Prepend initPrompt only to the first message of a brand-new thread
    const messageText = startedNewThread && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    // A worktree's git state (objects, refs, worktree metadata) lives in the main
    // repo's `.git`, outside the workspace. Grant it write access too, or `git
    // commit` fails under workspace-write. An unrestricted Codex session needs
    // neither this lookup nor an explicit list of writable roots.
    if (isSandboxed && chat.gitCommonDir === null) {
      try {
        chat.gitCommonDir = await backend.invoke<string>("get_git_common_dir", { workingDir })
      } catch (err) {
        console.warn(`Failed to resolve git dir for Codex sandbox [${chatId}]:`, err)
        chat.gitCommonDir = "" // don't retry every turn
      }
    }
    const sandboxPolicy = isSandboxed
      ? {
          type: "workspaceWrite",
          writableRoots: chat.gitCommonDir ? [workingDir, chat.gitCommonDir] : [workingDir],
          networkAccess: true,
        }
      : { type: "dangerFullAccess" }

    // Send the turn
    await this.sendRequest(chatId, "turn/start", {
      threadId: chat.threadId,
      input: [{ type: "text", text: messageText }],
      cwd: workingDir,
      approvalPolicy,
      sandboxPolicy,
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
    await backend.invoke("codex_stdin", {
      serverId: chat.serverId,
      data: response,
    })
  }

  async interruptTurn(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat?.threadId || !chat.turnId) return

    const turnId = chat.turnId
    // Clear now so a repeated stop is a no-op.
    chat.turnId = null

    // turn/interrupt is a JSON-RPC *request*, not a notification (the only client
    // notification the app-server accepts is "initialized"). Sent without an id it
    // gets ignored and Codex keeps streaming, so the stop button does nothing. Fire
    // it as a request and let the empty response resolve in the background — we
    // don't kill the server, to preserve thread context.
    void this.sendRequest(chatId, "turn/interrupt", {
      threadId: chat.threadId,
      turnId,
    }).catch((err) => {
      console.warn(`Failed to interrupt Codex turn [${chatId}]:`, err)
    })
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat) return

    // Interrupt any running turn first
    await this.interruptTurn(chatId)

    chat.running = false
    await backend.invoke("stop_codex_server", { serverId: chat.serverId })
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
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const chat = this.chats.get(chatId)
    if (!chat) throw new Error(`No chat for ${chatId}`)

    const id = this.nextId++
    const msg = JSON.stringify(params ? { method, id, params } : { method, id })

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { chatId, resolve, reject })
      backend.invoke("codex_stdin", { serverId: chat.serverId, data: msg }).catch(reject)
    })
  }

  private sendNotification(chatId: string, method: string, params: Record<string, unknown>): void {
    const chat = this.chats.get(chatId)
    if (!chat) return

    const msg = JSON.stringify({ method, params })
    backend.invoke("codex_stdin", { serverId: chat.serverId, data: msg }).catch((err) => {
      console.warn(`Failed to send codex notification [${chatId}]:`, err)
    })
  }

  // --- Private: Event handling ---

  /**
   * Handle raw stdout lines - only for JSON-RPC responses to our requests.
   * All other parsing is done in Rust.
   */
  private handleResponseLine(chatId: string, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: unknown
    try {
      msg = JSON.parse(trimmed)
    } catch {
      return // Not valid JSON, ignore
    }

    if (typeof msg === "object" && msg !== null && "method" in msg) {
      const notification = msg as JsonRpcNotification
      if (notification.method === "account/rateLimits/updated") {
        const usageData = parseRateLimitNotification(notification.params)
        if (usageData) {
          codexUsageStore.setUsageData(usageData)
        }
      } else if (notification.method === "turn/started") {
        // Track the in-flight turn id so interruptTurn can target it.
        const params = notification.params
        const turnId =
          isRecord(params) && isRecord(params.turn) && typeof params.turn.id === "string"
            ? params.turn.id
            : null
        const chat = this.chats.get(chatId)
        if (chat && turnId) chat.turnId = turnId
      } else if (notification.method === "turn/completed") {
        const chat = this.chats.get(chatId)
        if (chat) chat.turnId = null
      }
      return
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

  private async fetchRateLimits(chatId: string): Promise<void> {
    const response = await this.sendRequest(chatId, "account/rateLimits/read")
    const usageData = parseRateLimitResponse(response)
    if (usageData) {
      codexUsageStore.setUsageData(usageData)
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
          isProcessed: event.is_processed ?? false,
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
        console.warn(`Unknown Codex event kind: ${event.kind}`)
    }
  }

  private emitEvent(chatId: string, event: AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }
}

export const codexAgentService = new CodexAgentService()
