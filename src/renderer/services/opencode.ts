/**
 * OpenCode Agent Service
 *
 * # Why Parsing is in TypeScript (not Rust)
 *
 * Unlike Claude, Codex, Copilot, and Gemini which stream output via stdout,
 * OpenCode uses an HTTP REST API:
 *
 * 1. Rust spawns `opencode serve` on a port
 * 2. TypeScript uses `@opencode-ai/sdk` to make HTTP calls
 * 3. `session/prompt` returns complete response with `parts` array
 * 4. TypeScript parses the `parts` array into AgentEvents
 *
 * The actual chat content never flows through stdout - it comes via HTTP
 * responses directly to TypeScript. The Rust side only manages the HTTP
 * server process lifecycle.
 *
 * # No Tool Approvals
 *
 * OpenCode uses permissive permissions (`"*": "allow"`) so no interactive
 * tool approval prompts are shown.
 */

import { backend, type Unsubscribe } from "../backend"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { AgentService, AgentEventCallback, AgentDoneCallback, AgentEvent } from "./types"
import { configStore } from "../stores/ConfigStore"
import { toolAvailabilityStore } from "../stores/ToolAvailabilityStore"
import type { AgentModel } from "../types"

/** Model info returned from OpenCode server */
export interface OpenCodeModel {
  id: string
  name: string
  provider_id: string
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
function formatSpawnError(error: unknown, opencodePath: string): string {
  const errorStr = error instanceof Error ? error.message : String(error)

  if (isCommandNotFoundError(errorStr)) {
    // Update tool availability store
    toolAvailabilityStore.markUnavailable("opencode", errorStr)

    return `OpenCode CLI not found at "${opencodePath}".

To fix this:
1. Install OpenCode: npm i -g opencode-ai@latest
2. Or update the path in ~/.config/overseer/config.json

Current path: ${opencodePath}`
  }

  // Return original error for other failures
  return errorStr
}

/**
 * Wait for the OpenCode server to be ready by polling the health endpoint.
 */
async function waitForServerReady(
  client: OpencodeClient,
  maxAttempts = 50,
  delayMs = 200
): Promise<void> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await client.global.health()
      if (result.data?.healthy) {
        console.log(`OpenCode server ready after ${attempt + 1} attempts`)
        return
      }
    } catch {
      // Server not ready yet, continue polling
    }
    await delay(delayMs)
  }
  throw new Error(`OpenCode server failed to start after ${maxAttempts} attempts`)
}

// Part types from OpenCode response
interface OpenCodePart {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  tool?: {
    name: string
    input?: unknown
    output?: unknown
  }
  time?: {
    start: number
    end: number
  }
}

interface OpenCodeChat {
  serverId: string
  sessionId: string | null
  port: number
  running: boolean
  workingDir: string
  client: OpencodeClient | null
  unlistenClose: Unsubscribe | null
}

/**
 * OpenCodeAgentService manages communication with OpenCode's HTTP server.
 *
 * Architecture:
 * - One `opencode serve` process per serverId (workspace).
 * - Uses the official @opencode-ai/sdk for communication.
 * - Uses permissive permissions config ("*": "allow") to avoid approval prompts.
 * - Uses synchronous prompt API (waits for full response) instead of SSE streaming.
 */
class OpenCodeAgentService implements AgentService {
  private chats: Map<string, OpenCodeChat> = new Map()
  private eventCallbacks: Map<string, AgentEventCallback> = new Map()
  private doneCallbacks: Map<string, AgentDoneCallback> = new Map()

  private getOrCreateChat(chatId: string): OpenCodeChat {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = {
        serverId: chatId,
        sessionId: null,
        port: 0,
        running: false,
        workingDir: "",
        client: null,
        unlistenClose: null,
      }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private async attachCloseListener(chatId: string): Promise<void> {
    const chat = this.getOrCreateChat(chatId)
    const serverId = chat.serverId

    if (!chat.unlistenClose) {
      chat.unlistenClose = await backend.listen<{ code: number }>(
        `opencode:close:${serverId}`,
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
      await this.attachCloseListener(chatId)

      console.log(`Starting OpenCode server [${chatId}]`)
      try {
        const result = await backend.invoke<string>("start_opencode_server", {
          serverId: chat.serverId,
          opencodePath: configStore.opencodePath,
          port: 14096,
          logDir: logDir ?? null,
          logId: chatId,
          agentShell: configStore.agentShell || null,
        })
        // Parse the JSON response containing port
        const { port } = JSON.parse(result)
        chat.port = port
        console.log(`OpenCode server spawned on port ${port}, waiting for ready...`)

        // Create SDK client for this server
        chat.client = createOpencodeClient({
          baseUrl: `http://127.0.0.1:${port}`,
          directory: workingDir,
        })

        // Wait for the server to be ready before proceeding
        await waitForServerReady(chat.client)
      } catch (err) {
        throw new Error(formatSpawnError(err, configStore.opencodePath))
      }
      chat.running = true
    }

    const client = chat.client!

    // Create session if needed
    if (!chat.sessionId) {
      // Permissive mode - allow all permissions without prompts
      const result = await client.session.create({
        directory: workingDir,
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      })

      if (result.error) {
        throw new Error(`Failed to create OpenCode session: ${JSON.stringify(result.error)}`)
      }

      chat.sessionId = result.data!.id
      this.emitEvent(chatId, { kind: "sessionId", sessionId: result.data!.id })
    }

    // Prepend initPrompt to the first message of a new session
    const messageText = isNewSession && initPrompt ? `${initPrompt}\n\n${prompt}` : prompt

    // Send message and wait for response (synchronous API)
    const sessionId = chat.sessionId!

    // Parse model string (format: "provider/model" e.g. "anthropic/claude-sonnet-4-5")
    let modelParam: { providerID: string; modelID: string } | undefined
    if (modelVersion) {
      const slashIndex = modelVersion.indexOf("/")
      if (slashIndex > 0) {
        modelParam = {
          providerID: modelVersion.substring(0, slashIndex),
          modelID: modelVersion.substring(slashIndex + 1),
        }
      } else {
        // No provider prefix, use as-is with empty provider
        modelParam = { providerID: "", modelID: modelVersion }
      }
    }

    const response = await client.session.prompt({
      sessionID: sessionId,
      directory: workingDir,
      parts: [{ type: "text", text: messageText }],
      model: modelParam,
    })

    if (response.error) {
      throw new Error(`Failed to send message: ${JSON.stringify(response.error)}`)
    }

    // Process the response parts
    const data = response.data as { parts?: OpenCodePart[] } | undefined
    if (data?.parts) {
      this.processResponseParts(chatId, data.parts)
    }

    // Signal completion
    this.emitEvent(chatId, { kind: "turnComplete" })
    this.emitEvent(chatId, { kind: "done" })
    this.doneCallbacks.get(chatId)?.()
  }

  private processResponseParts(chatId: string, parts: OpenCodePart[]): void {
    for (const part of parts) {
      switch (part.type) {
        case "text": {
          if (part.text) {
            this.emitEvent(chatId, { kind: "text", text: part.text })
          }
          break
        }

        case "tool-invocation": {
          const toolName = part.tool?.name || "tool"
          const toolInput = part.tool?.input || {}
          const content = `${toolName}\n${JSON.stringify(toolInput, null, 2)}`
          this.emitEvent(chatId, {
            kind: "message",
            content,
            toolMeta: { toolName },
          })

          // If tool has output, emit it
          if (part.tool?.name === "bash" && part.tool?.output) {
            const output =
              typeof part.tool.output === "string"
                ? part.tool.output
                : JSON.stringify(part.tool.output)
            this.emitEvent(chatId, { kind: "bashOutput", text: output })
          }
          break
        }

        // Ignore step-start and step-finish - they're lifecycle events
        case "step-start":
        case "step-finish":
          break
      }
    }
  }

  async sendToolApproval(
    _chatId: string,
    _requestId: string,
    _approved: boolean,
    _toolInput?: Record<string, unknown>,
    _denyMessage?: string
  ): Promise<void> {
    // No-op: OpenCode uses permissive permissions ("*": "allow")
    // so no approval prompts are shown
  }

  async interruptTurn(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat?.sessionId || !chat.client) return

    // Abort the current operation without stopping the server
    try {
      await chat.client.session.abort({
        sessionID: chat.sessionId,
        directory: chat.workingDir,
      })
    } catch {
      // ignore - server might already be down
    }
  }

  async stopChat(chatId: string): Promise<void> {
    const chat = this.chats.get(chatId)
    if (!chat) return

    // Interrupt any running turn first
    await this.interruptTurn(chatId)

    // Stop the server
    chat.running = false
    await backend.invoke("stop_opencode_server", { serverId: chat.serverId })
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
    this.persistEvent(chatId, event)
    this.eventCallbacks.get(chatId)?.(event)
  }

  private persistEvent(chatId: string, event: AgentEvent): void {
    const rustEvent = this.toRustEvent(event)
    if (!rustEvent) return
    void backend
      .invoke("append_chat_event", {
        chatId,
        event: rustEvent,
      })
      .catch((err) => {
        console.error("Failed to persist OpenCode event:", err)
      })
  }

  private toRustEvent(event: AgentEvent): Record<string, unknown> | null {
    switch (event.kind) {
      case "text":
        return { kind: "text", text: event.text }
      case "bashOutput":
        return { kind: "bashOutput", text: event.text }
      case "message": {
        const toolMeta = event.toolMeta
          ? {
              tool_name: event.toolMeta.toolName,
              lines_added: event.toolMeta.linesAdded,
              lines_removed: event.toolMeta.linesRemoved,
            }
          : undefined
        return {
          kind: "message",
          content: event.content,
          tool_meta: toolMeta,
          parent_tool_use_id: event.parentToolUseId ?? undefined,
          tool_use_id: event.toolUseId ?? undefined,
          is_info: event.isInfo ?? undefined,
        }
      }
      case "toolApproval":
        return {
          kind: "toolApproval",
          request_id: event.id,
          name: event.name,
          input: event.input,
          display_input: event.displayInput,
          prefixes: event.commandPrefixes,
          auto_approved: event.autoApproved ?? false,
          is_processed: event.isProcessed ?? false,
        }
      case "question":
        return {
          kind: "question",
          request_id: event.id,
          questions: event.questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options,
            multi_select: q.multiSelect,
          })),
          raw_input: event.rawInput,
          is_processed: event.isProcessed ?? false,
        }
      case "planApproval":
        return {
          kind: "planApproval",
          request_id: event.id,
          content: event.planContent,
          is_processed: event.isProcessed ?? false,
        }
      case "sessionId":
        return { kind: "sessionId", session_id: event.sessionId }
      case "turnComplete":
        return { kind: "turnComplete" }
      case "done":
        return { kind: "done" }
      case "userMessage":
        return {
          kind: "userMessage",
          id: event.id,
          content: event.content,
          timestamp: event.timestamp.toISOString(),
          meta: event.meta ?? null,
        }
      default:
        return null
    }
  }

  /**
   * Fetch available models from the OpenCode server.
   * The server must be running for this to work.
   */
  async getModels(chatId: string): Promise<AgentModel[]> {
    const chat = this.chats.get(chatId)
    if (!chat?.running) {
      return []
    }

    try {
      const models = await backend.invoke<OpenCodeModel[]>("opencode_get_models", {
        serverId: chat.serverId,
      })

      return models.map((m) => ({
        alias: m.id,
        displayName: m.name,
      }))
    } catch (err) {
      console.error("Failed to fetch OpenCode models:", err)
      return []
    }
  }
}

export const opencodeAgentService = new OpenCodeAgentService()

/**
 * Fetch available OpenCode models by running `opencode models` CLI command.
 * This works without a running server.
 */
export async function listOpencodeModels(
  opencodePath: string,
  agentShell: string | null
): Promise<AgentModel[]> {
  try {
    const models = await backend.invoke<OpenCodeModel[]>("opencode_list_models", {
      opencodePath,
      agentShell,
    })

    return models.map((m) => ({
      alias: m.id,
      displayName: m.name,
    }))
  } catch (err) {
    console.error("Failed to list OpenCode models:", err)
    return []
  }
}
