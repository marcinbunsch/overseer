import { backend, type Unsubscribe } from "../backend"
import type { QuestionItem, ToolMeta } from "../types"
import { getCommandPrefixes } from "../types"
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

interface ClaudeStreamEvent {
  type: string
  subtype?: string
  session_id?: string
  request_id?: string
  /** ID of parent Task tool_use - for subagent messages */
  parent_tool_use_id?: string | null
  request?: {
    subtype: string
    tool_name: string
    input: Record<string, unknown> & { questions?: QuestionItem[] }
    tool_use_id?: string
    decision_reason?: string
  }
  message?: {
    role: string
    content: Array<{
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: {
        questions?: QuestionItem[]
        [key: string]: unknown
      }
    }>
  }
  content_block?: {
    type: string
    text?: string
    id?: string
    name?: string
    input?: unknown
  }
  delta?: {
    type: string
    text?: string
  }
  result?: string
}

interface ConversationProcess {
  sessionId: string | null
  running: boolean
  buffer: string
  rawOutput: string
  unlistenStdout: Unsubscribe | null
  unlistenStderr: Unsubscribe | null
  unlistenClose: Unsubscribe | null
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
        buffer: "",
        rawOutput: "",
        unlistenStdout: null,
        unlistenStderr: null,
        unlistenClose: null,
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
        this.handleOutput(chatId, `${payload}\n`)
      })
    }

    if (!conv.unlistenStderr) {
      conv.unlistenStderr = await backend.listen<string>(`agent:stderr:${chatId}`, (payload) => {
        if (payload) {
          console.warn(`Claude stderr [${chatId}]:`, payload)
        }
      })
    }

    if (!conv.unlistenClose) {
      conv.unlistenClose = await backend.listen<{ code: number }>(`agent:close:${chatId}`, () => {
        if (conv.buffer.trim()) {
          this.parseLine(chatId, conv.buffer.trim())
          conv.buffer = ""
        }
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
    initPrompt?: string
  ): Promise<void> {
    await this.attachListeners(chatId)
    const conv = this.getOrCreateConversation(chatId)

    // If process is already running, send follow-up via stdin
    if (conv.running && conv.sessionId) {
      const envelope = {
        type: "user",
        message: {
          role: "user",
          content: prompt,
        },
      }
      console.log(`Sending follow-up via stdin [${chatId}], session:`, conv.sessionId)
      await backend.invoke("agent_stdin", {
        conversationId: chatId,
        data: JSON.stringify(envelope),
      })
      return
    }

    // Otherwise start a new process
    await this.stopChat(chatId)
    conv.buffer = ""
    conv.rawOutput = ""

    // Prepend initPrompt to the first message (meta instruction)
    const messageText = initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    console.log(
      `Starting Claude process [${chatId}] in dir:`,
      workingDir,
      "session:",
      conv.sessionId
    )

    try {
      await backend.invoke("start_agent", {
        conversationId: chatId,
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

  private handleOutput(chatId: string, data: string): void {
    const conv = this.conversations.get(chatId)
    if (!conv) return

    conv.buffer += data
    const lines = conv.buffer.split("\n")
    conv.buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        this.parseLine(chatId, trimmed)
      }
    }
  }

  private parseLine(chatId: string, line: string): void {
    try {
      const event = JSON.parse(line) as ClaudeStreamEvent
      const conv = this.conversations.get(chatId)

      if (event.session_id && conv && !conv.sessionId) {
        conv.sessionId = event.session_id
        this.emitEvent(chatId, { kind: "sessionId", sessionId: event.session_id })
      }

      this.translateEvent(chatId, event)
    } catch {
      // Not valid JSON, ignore
    }
  }

  /** Translate Claude-specific stream events into generic AgentEvents. */
  private translateEvent(chatId: string, event: ClaudeStreamEvent): void {
    // Get parent_tool_use_id for subagent message grouping
    const parentToolUseId = event.parent_tool_use_id

    // assistant event — one message per content block
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "thinking" && block.thinking) {
          // Extended thinking block — emit as collapsible tool-style message
          this.emitEvent(chatId, {
            kind: "message",
            content: block.thinking,
            toolMeta: { toolName: "Thinking", linesAdded: 0, linesRemoved: 0 },
            parentToolUseId,
          })
        } else if (block.type === "text" && block.text) {
          this.emitEvent(chatId, {
            kind: "message",
            content: block.text.trim(),
            parentToolUseId,
          })
        } else if (
          block.type === "tool_use" &&
          (block.name === "AskUserQuestion" || block.name === "ExitPlanMode")
        ) {
          // Skip — handled via control_request
        } else if (block.type === "tool_use") {
          const input = block.input != null ? JSON.stringify(block.input, null, 2) : ""
          let toolMeta: ToolMeta | undefined
          if (block.name === "Edit" && block.input) {
            const oldStr = typeof block.input.old_string === "string" ? block.input.old_string : ""
            const newStr = typeof block.input.new_string === "string" ? block.input.new_string : ""
            toolMeta = {
              toolName: block.name,
              linesAdded: newStr ? newStr.split("\n").length : 0,
              linesRemoved: oldStr ? oldStr.split("\n").length : 0,
            }
          }
          // For Task tools, include the block.id so child messages can reference it
          const toolUseId = block.name === "Task" ? block.id : undefined
          this.emitEvent(chatId, {
            kind: "message",
            content: input ? `[${block.name}]\n${input}` : `[${block.name}]`,
            toolMeta,
            parentToolUseId,
            toolUseId,
          })
        }
      }
      return
    }

    // content_block_start — progressive tool display
    if (event.type === "content_block_start" && event.content_block) {
      if (event.content_block.type === "tool_use" && event.content_block.name) {
        this.emitEvent(chatId, {
          kind: "text",
          text: `\n[${event.content_block.name}] ...`,
        })
      }
      return
    }

    // content_block_delta — streaming text
    if (event.type === "content_block_delta" && event.delta?.text) {
      this.emitEvent(chatId, { kind: "text", text: event.delta.text })
      return
    }

    // result — turn complete
    if (event.type === "result") {
      this.emitEvent(chatId, { kind: "turnComplete" })
      return
    }

    // control_request — tool approval or question
    if (
      event.type === "control_request" &&
      event.request_id &&
      event.request?.subtype === "can_use_tool"
    ) {
      const toolName = event.request.tool_name

      // AskUserQuestion
      if (toolName === "AskUserQuestion" && event.request.input?.questions) {
        this.emitEvent(chatId, {
          kind: "question",
          id: event.request_id,
          questions: event.request.input.questions as QuestionItem[],
          rawInput: event.request.input,
        })
        return
      }

      // ExitPlanMode
      if (toolName === "ExitPlanMode") {
        const planContent =
          typeof event.request.input?.plan === "string" ? event.request.input.plan : ""
        this.emitEvent(chatId, {
          kind: "planApproval",
          id: event.request_id,
          planContent,
        })
        return
      }

      // Regular tool approval
      const toolInput = event.request.input ?? {}
      const displayInput =
        Object.keys(toolInput).length > 0 ? JSON.stringify(toolInput, null, 2) : ""
      const cmdPrefixes = toolName === "Bash" ? getCommandPrefixes(toolInput) : undefined

      this.emitEvent(chatId, {
        kind: "toolApproval",
        id: event.request_id,
        name: toolName,
        input: toolInput,
        displayInput,
        commandPrefixes: cmdPrefixes,
      })
      return
    }

    // Everything else — ignore
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
