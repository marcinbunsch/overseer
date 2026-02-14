import type { QuestionItem, ToolMeta } from "../types"

export type AgentType = "claude" | "codex" | "copilot" | "gemini" | "opencode"

export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "bashOutput"; text: string }
  | {
      kind: "message"
      content: string
      toolMeta?: ToolMeta
      isInfo?: boolean
      /** ID of parent Task tool_use - for grouping subagent messages */
      parentToolUseId?: string | null
      /** Tool use ID for Task tools - used to match child messages */
      toolUseId?: string
    }
  | {
      kind: "toolApproval"
      id: string
      name: string
      input: Record<string, unknown>
      displayInput: string
      /** Command prefixes extracted from Bash commands (handles chained commands) */
      commandPrefixes?: string[]
      /** Permission options from Copilot (allow_once, allow_always, etc.) */
      options?: Array<{ id: string; name: string; kind: string }>
    }
  | {
      kind: "question"
      id: string
      questions: QuestionItem[]
      rawInput: Record<string, unknown>
    }
  | { kind: "planApproval"; id: string; planContent: string }
  | { kind: "sessionId"; sessionId: string }
  | { kind: "turnComplete" }
  | { kind: "done" }

export type AgentEventCallback = (event: AgentEvent) => void
export type AgentDoneCallback = () => void

export interface AgentService {
  sendMessage(
    chatId: string,
    prompt: string,
    workingDir: string,
    logDir?: string,
    modelVersion?: string | null,
    permissionMode?: string | null,
    initPrompt?: string
  ): Promise<void>
  sendToolApproval(
    chatId: string,
    requestId: string,
    approved: boolean,
    toolInput?: Record<string, unknown>,
    denyMessage?: string
  ): Promise<void>
  /** Interrupt current turn without killing the process. Use for "Stop" button. */
  interruptTurn(chatId: string): Promise<void>
  /** Stop chat and kill the process. Use for archive/delete. */
  stopChat(chatId: string): Promise<void>
  isRunning(chatId: string): boolean
  getSessionId(chatId: string): string | null
  setSessionId(chatId: string, sessionId: string | null): void
  removeChat(chatId: string): void
  onEvent(chatId: string, callback: AgentEventCallback): void
  onDone(chatId: string, callback: AgentDoneCallback): void
}
