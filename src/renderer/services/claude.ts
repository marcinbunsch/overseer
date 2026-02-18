import { backend, type Unsubscribe } from "../backend"
import type { QuestionItem, ToolMeta } from "../types"
import type { AgentService, AgentEventCallback, AgentDoneCallback } from "./types"
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
function formatSpawnError(error: unknown, agentPath: string, workingDir?: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  // Log detailed debug info for investigation
  console.error("[Claude spawn error] Debug info:", {
    error: errorStr,
    rawError: error,
    agentPath,
    workingDir,
    configStoreState: {
      claudePath: configStore.claudePath,
      loaded: configStore.loaded,
    },
    toolAvailabilityState: {
      claude: toolAvailabilityStore.claude,
    },
    isCommandNotFound: isCommandNotFoundError(errorStr),
  })

  if (isCommandNotFoundError(errorStr)) {
    // Update tool availability store
    toolAvailabilityStore.markUnavailable("claude", errorStr)

    return `Claude CLI not found at "${agentPath}".

To fix this:
1. Install Claude Code from https://claude.ai/code
2. Or update the path in ~/.config/overseer/config.json

Current path: ${agentPath}`
  }

  // Return original error for other failures
  return errorStr
}

type BackendToolMeta = {
  tool_name: string
  lines_added?: number | null
  lines_removed?: number | null
}

type BackendQuestionItem = {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multi_select?: boolean
}

type BackendAgentEvent =
  | { kind: "text"; text: string }
  | { kind: "bashOutput"; text: string }
  | {
      kind: "message"
      content: string
      tool_meta?: BackendToolMeta | null
      parent_tool_use_id?: string | null
      tool_use_id?: string | null
      is_info?: boolean | null
    }
  | {
      kind: "toolApproval"
      request_id: string
      name: string
      input: Record<string, unknown>
      display_input: string
      prefixes?: string[] | null
      auto_approved?: boolean
      is_processed?: boolean
    }
  | {
      kind: "question"
      request_id: string
      questions: BackendQuestionItem[]
      raw_input?: Record<string, unknown>
      is_processed?: boolean
    }
  | { kind: "planApproval"; request_id: string; content: string; is_processed?: boolean }
  | { kind: "sessionId"; session_id: string }
  | { kind: "turnComplete" }
  | { kind: "done" }
  | { kind: "error"; message: string }

interface ConversationProcess {
  sessionId: string | null
  running: boolean
  rawOutput: string
  unlistenStdout: Unsubscribe | null
  unlistenStderr: Unsubscribe | null
  unlistenClose: Unsubscribe | null
  unlistenEvent: Unsubscribe | null
}

class ClaudeAgentService implements AgentService {
  private conversations: Map<string, ConversationProcess> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()

  private getOrCreateConversation(chatId: string): ConversationProcess {
    let conv = this.conversations.get(chatId)
    if (!conv) {
      conv = {
        sessionId: null,
        running: false,
        rawOutput: "",
        unlistenStdout: null,
        unlistenStderr: null,
        unlistenClose: null,
        unlistenEvent: null,
      }
      this.conversations.set(chatId, conv)
    }
    return conv
  }

  private async attachListeners(chatId: string): Promise<void> {
    const conv = this.getOrCreateConversation(chatId)

    if (!conv.unlistenStdout) {
      conv.unlistenStdout = await backend.listen<string>(`agent:stdout:${chatId}`, (line) => {
        const payload = line ?? ""
        if (conv.rawOutput.length < 4096) {
          conv.rawOutput += payload
        }
      })
    }

    if (!conv.unlistenStderr) {
      conv.unlistenStderr = await backend.listen<string>(`agent:stderr:${chatId}`, (payload) => {
        if (payload) {
          console.warn(`Claude stderr [${chatId}]:`, payload)
        }
      })
    }

    if (!conv.unlistenEvent) {
      conv.unlistenEvent = await backend.listen<BackendAgentEvent>(
        `agent:event:${chatId}`,
        (event) => {
          this.handleBackendEvent(chatId, event)
        }
      )
    }

    if (!conv.unlistenClose) {
      conv.unlistenClose = await backend.listen<{ code: number }>(`agent:close:${chatId}`, () => {
        if (!conv.rawOutput.trim()) {
          console.warn(`Claude exited with no output [${chatId}]`)
        } else if (!conv.rawOutput.includes("{")) {
          console.warn(`Claude output (non-JSON) [${chatId}]:`, conv.rawOutput.slice(0, 2000))
        }
        conv.running = false
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
    projectName?: string
  ): Promise<void> {
    await this.attachListeners(chatId)
    const conv = this.getOrCreateConversation(chatId)

    // Prepend initPrompt only on the first message (no session yet)
    const isFirstMessage = !conv.sessionId
    const messageText = isFirstMessage && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    console.log(`Sending message [${chatId}] in dir:`, workingDir, "session:", conv.sessionId)

    try {
      // Backend decides whether to start a new process or send via stdin
      await backend.invoke("send_message", {
        conversationId: chatId,
        projectName: projectName ?? "",
        prompt: messageText,
        workingDir,
        agentPath: configStore.claudePath,
        sessionId: conv.sessionId ?? null,
        modelVersion: modelVersion ?? null,
        logDir: logDir ?? null,
        logId: chatId,
        permissionMode: permissionMode ?? null,
        agentShell: configStore.agentShell || null,
      })
      conv.running = true
    } catch (err) {
      // Re-throw with a more helpful error message
      throw new Error(formatSpawnError(err, configStore.claudePath, workingDir))
    }
  }

  async sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    toolInput: Record<string, unknown> = {},
    denyMessage?: string
  ): Promise<void> {
    const response = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: approved
          ? { behavior: "allow", updatedInput: toolInput }
          : { behavior: "deny", message: denyMessage || "User denied this tool use" },
      },
    }

    console.log(`Sending control_response [${chatId}]:`, response)

    await backend.invoke("agent_stdin", {
      conversationId: chatId,
      data: JSON.stringify(response),
    })
  }

  private handleBackendEvent(chatId: string, event: BackendAgentEvent): void {
    const conv = this.conversations.get(chatId)
    if (!conv) return

    switch (event.kind) {
      case "sessionId": {
        if (event.session_id && !conv.sessionId) {
          conv.sessionId = event.session_id
          this.emitEvent(chatId, { kind: "sessionId", sessionId: event.session_id })
        }
        return
      }
      case "text":
      case "bashOutput":
      case "turnComplete":
      case "done": {
        this.emitEvent(chatId, event as import("./types").AgentEvent)
        return
      }
      case "message": {
        const toolMeta: ToolMeta | undefined = event.tool_meta
          ? {
              toolName: event.tool_meta.tool_name,
              linesAdded: event.tool_meta.lines_added ?? undefined,
              linesRemoved: event.tool_meta.lines_removed ?? undefined,
            }
          : undefined
        this.emitEvent(chatId, {
          kind: "message",
          content: event.content,
          toolMeta,
          parentToolUseId: event.parent_tool_use_id ?? undefined,
          toolUseId: event.tool_use_id ?? undefined,
          isInfo: event.is_info ?? undefined,
        })
        return
      }
      case "toolApproval": {
        this.emitEvent(chatId, {
          kind: "toolApproval",
          id: event.request_id,
          name: event.name,
          input: event.input ?? {},
          displayInput: event.display_input ?? "",
          commandPrefixes: event.prefixes ?? undefined,
          autoApproved: event.auto_approved ?? false,
          isProcessed: event.is_processed ?? false,
        })
        return
      }
      case "question": {
        const questions: QuestionItem[] = event.questions.map((item) => ({
          question: item.question,
          header: item.header,
          options: item.options,
          multiSelect: item.multi_select ?? false,
        }))
        this.emitEvent(chatId, {
          kind: "question",
          id: event.request_id,
          questions,
          rawInput: event.raw_input ?? {},
          isProcessed: event.is_processed ?? false,
        })
        return
      }
      case "planApproval": {
        this.emitEvent(chatId, {
          kind: "planApproval",
          id: event.request_id,
          planContent: event.content ?? "",
          isProcessed: event.is_processed ?? false,
        })
        return
      }
      case "error": {
        console.error(`Claude event error [${chatId}]:`, event.message)
        this.emitEvent(chatId, {
          kind: "message",
          content: event.message,
          isInfo: true,
        })
        return
      }
      default:
        return
    }
  }

  private emitEvent(chatId: string, event: import("./types").AgentEvent): void {
    this.eventCallbacks.get(chatId)?.(event)
  }

  async interruptTurn(chatId: string): Promise<void> {
    // Claude doesn't have a protocol-level cancel, so interrupt = stop
    await this.stopChat(chatId)
  }

  async stopChat(chatId: string): Promise<void> {
    const conv = this.conversations.get(chatId)
    if (conv) {
      conv.running = false
    }
    await backend.invoke("stop_agent", { conversationId: chatId })
  }

  isRunning(chatId: string): boolean {
    return this.conversations.get(chatId)?.running ?? false
  }

  getSessionId(chatId: string): string | null {
    return this.conversations.get(chatId)?.sessionId ?? null
  }

  setSessionId(chatId: string, sessionId: string | null): void {
    const conv = this.getOrCreateConversation(chatId)
    conv.sessionId = sessionId
  }

  removeChat(chatId: string): void {
    const conv = this.conversations.get(chatId)
    if (conv) {
      conv.unlistenStdout?.()
      conv.unlistenStderr?.()
      conv.unlistenClose?.()
      conv.unlistenEvent?.()
    }
    this.conversations.delete(chatId)
    this.eventCallbacks.delete(chatId)
    this.doneCallbacks.delete(chatId)
  }

  onEvent(chatId: string, callback: AgentEventCallback): void {
    this.eventCallbacks.set(chatId, callback)
  }

  onDone(chatId: string, callback: AgentDoneCallback): void {
    this.doneCallbacks.set(chatId, callback)
  }
}

export const claudeAgentService = new ClaudeAgentService()
