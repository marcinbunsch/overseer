import { observable, computed, action, makeObservable, runInAction } from "mobx"
import { backend } from "../backend"
import type {
  Message,
  MessageMeta,
  MessageTurn,
  Chat,
  ChatStatus,
  AgentQuestion,
  PendingToolUse,
  PendingPlanApproval,
  AgentType,
} from "../types"
import { groupMessagesIntoTurns } from "../utils/groupMessagesIntoTurns"
import { getAgentService } from "../services/agentRegistry"
import type { AgentEvent, AgentService } from "../services/types"
import { configStore } from "./ConfigStore"
import { extractOverseerBlocks, type OverseerAction } from "../utils/overseerActions"
import { executeOverseerAction } from "../services/overseerActionExecutor"
import { eventBus } from "../utils/eventBus"

export interface ChatStoreContext {
  getChatDir: () => Promise<string | null>
  getInitPrompt: () => string | undefined
  getProjectName: () => string
  getWorkspaceName: () => string
  saveIndex: () => void
  getActiveChatId: () => string | null
  getWorkspacePath: () => string
  renameChat: (chatId: string, newLabel: string) => void
  isWorkspaceSelected: () => boolean
  refreshChangedFiles: () => void
}

type BackendQuestionItem = {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multi_select?: boolean
}

type BackendAgentEvent = {
  kind: string
  text?: string
  content?: string
  tool_meta?: { tool_name: string; lines_added?: number; lines_removed?: number }
  parent_tool_use_id?: string | null
  tool_use_id?: string | null
  is_info?: boolean
  request_id?: string
  name?: string
  input?: Record<string, unknown>
  display_input?: string
  prefixes?: string[] | null
  auto_approved?: boolean
  is_processed?: boolean
  questions?: BackendQuestionItem[]
  raw_input?: Record<string, unknown>
  session_id?: string
  id?: string
  timestamp?: string
  meta?: Record<string, unknown>
}

type BackendChatMetadata = {
  id: string
  workspaceId: string
  label: string
  agentType?: AgentType | null
  agentSessionId?: string | null
  modelVersion?: string | null
  permissionMode?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Event with sequence number from backend.
 * Both WebSocket events and HTTP responses use this same flattened format
 * (seq alongside the event fields, not nested).
 */
type BackendSeqEvent = {
  seq: number
} & BackendAgentEvent

export class ChatStore {
  @observable chat: Chat
  @observable isSending: boolean = false
  @observable pendingToolUses: PendingToolUse[] = []
  @observable pendingQuestions: AgentQuestion[] = []
  @observable pendingPlanApproval: PendingPlanApproval | null = null
  /** Tracks rejected plan content for showing diff when agent revises */
  private _lastRejectedPlanContent: string | null = null
  @observable pendingFollowUps: string[] = []
  @observable draft: string = ""
  @observable loaded: boolean = false
  @observable loading: boolean = false

  private context: ChatStoreContext
  private sessionRegistered: boolean = false
  /** Set of sequence numbers we've already processed - for deduplication */
  private seenSeqs = new Set<number>()
  /** Highest sequence number seen - for catch-up queries */
  private lastSeenSeq: number = 0
  /** Unsubscribe function for reconnection handler */
  private unsubscribeReconnect?: () => void
  /** Bound visibility change handler for cleanup */
  private boundVisibilityHandler?: () => void

  constructor(chat: Chat, context: ChatStoreContext) {
    this.chat = chat
    this.context = context
    makeObservable(this)
    this.registerCallbacks()
    this.loadDraft()
    this.setupReconnectHandler()
    this.setupVisibilityHandler()
  }

  // --- Computed ---

  @computed get id(): string {
    return this.chat.id
  }

  @computed get label(): string {
    return this.chat.label
  }

  @computed get messages(): Message[] {
    return this.chat.messages
  }

  @computed get turns(): MessageTurn[] {
    // When a plan approval is pending, treat as not sending so the turn
    // gets finalized and the plan text shows as the result message.
    const sending = this.isSending && !this.pendingPlanApproval
    return groupMessagesIntoTurns(this.chat.messages, sending)
  }

  @computed get status(): ChatStatus {
    // Derive status from runtime state
    if (
      this.pendingToolUses.length > 0 ||
      this.pendingQuestions.length > 0 ||
      this.pendingPlanApproval
    ) {
      return "needs_attention"
    }
    if (this.isSending) {
      return "running"
    }
    // Only use persisted "done" status (for green dot on background completed chats)
    if (this.chat.status === "done") {
      return "done"
    }
    return "idle"
  }

  @computed get agentType(): AgentType | undefined {
    return this.chat.agentType
  }

  @computed get modelVersion(): string | null {
    return this.chat.modelVersion
  }

  @computed get permissionMode(): string | null {
    return this.chat.permissionMode
  }

  // --- Private: service accessor ---

  private get service(): AgentService | null {
    if (!this.chat.agentType) return null
    return getAgentService(this.chat.agentType)
  }

  // --- Public actions ---

  @action async ensureLoaded(): Promise<void> {
    if (!this.loaded && !this.loading) {
      await this.loadFromDisk()
    }
  }

  @action async sendMessage(
    content: string,
    workspacePath: string,
    meta?: MessageMeta
  ): Promise<void> {
    // If agent is responding, queue as follow-up instead
    if (this.isSending) {
      this.pendingFollowUps.push(content)
      this.setDraft("")
      return
    }
    if (!this.service) return // Can't send without an agent

    // Pass initPrompt only on the first message of a new session
    const isFirstMessage = this.chat.messages.length === 0
    let initPrompt = isFirstMessage ? this.context?.getInitPrompt() : undefined

    // Add agent-specific shell instructions for Codex
    if (isFirstMessage && this.chat.agentType === "codex") {
      const shellInfo = configStore.agentShell
        ? configStore.agentShell
        : "a login shell (determined by $SHELL environment variable)"
      const shellInstructions = `\n\nIMPORTANT: All bash commands are already running in ${shellInfo}. Do NOT wrap commands with "zsh -l -c" or any other shell prefix - they are already executed in the configured shell environment.`
      initPrompt = initPrompt ? initPrompt + shellInstructions : shellInstructions
    }

    await this.persistUserMessage(content, meta)
    this.isSending = true
    this.setDraft("")

    try {
      const logDir = (await this.context?.getChatDir()) ?? undefined
      // Use chat's permission mode if set, otherwise fall back to global config
      const permissionMode =
        this.chat.agentType === "claude"
          ? (this.chat.permissionMode ?? configStore.claudePermissionMode)
          : this.chat.agentType === "codex"
            ? configStore.codexApprovalPolicy
            : null
      const projectName = this.context?.getProjectName() ?? ""
      await this.service.sendMessage(
        this.chat.id,
        content,
        workspacePath,
        logDir,
        this.chat.modelVersion,
        permissionMode,
        initPrompt,
        projectName
      )
    } catch (err) {
      console.error("Error sending message:", err)
      runInAction(() => {
        this.chat.messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
        })
        this.isSending = false
      })
      void this.persistLocalAssistantMessage(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  @action stopGeneration(): void {
    if (!this.service) return
    this.service.interruptTurn(this.chat.id)
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "[cancelled]",
      timestamp: new Date(),
    })
    void this.persistLocalAssistantMessage("[cancelled]")
    this.isSending = false
    this.pendingFollowUps = []
  }

  @action clearPendingFollowUps(): void {
    this.pendingFollowUps = []
  }

  @action removeFollowUp(index: number): void {
    if (index >= 0 && index < this.pendingFollowUps.length) {
      this.pendingFollowUps.splice(index, 1)
    }
  }

  @action async approveToolUse(toolId: string, approved: boolean): Promise<void> {
    if (!this.service) return
    const tool = this.pendingToolUses.find((t) => t.id === toolId)
    try {
      await this.service.sendToolApproval(this.chat.id, toolId, approved, tool?.rawInput ?? {})
    } catch (err) {
      console.error("Error sending tool approval:", err)
    }
    runInAction(() => {
      this.pendingToolUses = this.pendingToolUses.filter((t) => t.id !== toolId)
      this.clearUnreadStatus()
    })
  }

  @action async denyToolUseWithExplanation(toolId: string, explanation: string): Promise<void> {
    if (!this.service) return
    const tool = this.pendingToolUses.find((t) => t.id === toolId)
    const denyMessage = explanation.trim()
      ? `User denied this tool use and requested something different:\n\n${explanation.trim()}`
      : "User denied this tool use"
    try {
      await this.service.sendToolApproval(
        this.chat.id,
        toolId,
        false,
        tool?.rawInput ?? {},
        denyMessage
      )
    } catch (err) {
      console.error("Error sending tool denial with explanation:", err)
    }
    if (explanation.trim()) {
      await this.persistUserMessage(explanation.trim())
    }
    runInAction(() => {
      this.pendingToolUses = this.pendingToolUses.filter((t) => t.id !== toolId)
      this.clearUnreadStatus()
    })
  }

  @action async approveToolUseAll(
    toolId: string,
    scope: "tool" | "command" = "tool"
  ): Promise<void> {
    if (!this.service) return
    const tool = this.pendingToolUses.find((t) => t.id === toolId)
    const projectName = this.context?.getProjectName() ?? ""

    console.log("[approveToolUseAll] tool:", tool, "projectName:", projectName, "scope:", scope)
    if (tool && projectName) {
      // Persist approval to Rust backend (source of truth)
      try {
        if (scope === "command" && tool.commandPrefixes?.length) {
          console.log("[approveToolUseAll] Adding command prefixes:", tool.commandPrefixes)
          for (const prefix of tool.commandPrefixes) {
            console.log("[approveToolUseAll] Invoking add_approval for prefix:", prefix)
            await backend.invoke("add_approval", {
              projectName,
              toolOrPrefix: prefix,
              isPrefix: true,
            })
          }
        } else {
          console.log("[approveToolUseAll] Adding tool:", tool.name)
          await backend.invoke("add_approval", {
            projectName,
            toolOrPrefix: tool.name,
            isPrefix: false,
          })
        }
      } catch (err) {
        console.error("Error persisting approval:", err)
      }
    } else {
      console.log("[approveToolUseAll] Skipping - tool or projectName missing")
    }

    try {
      await this.service.sendToolApproval(this.chat.id, toolId, true, tool?.rawInput ?? {})
    } catch (err) {
      console.error("Error sending tool approval:", err)
    }

    runInAction(() => {
      if (!tool) {
        this.pendingToolUses = this.pendingToolUses.filter((t) => t.id !== toolId)
        return
      }
      // Find matching pending tools to also auto-approve
      // Note: Rust will handle auto-approval for future tools, but we still
      // need to approve any currently pending tools that match
      const matches = this.pendingToolUses.filter((t) => {
        if (t.id === toolId) return false
        if (scope === "command" && tool.commandPrefixes?.length) {
          // Check if all prefixes in this tool match
          return (
            t.name === "Bash" &&
            t.commandPrefixes?.length &&
            t.commandPrefixes.every((p) => tool.commandPrefixes!.includes(p))
          )
        }
        return t.name === tool.name
      })
      for (const t of matches) {
        this.service?.sendToolApproval(this.chat.id, t.id, true, t.rawInput)
      }
      const matchIds = new Set([toolId, ...matches.map((t) => t.id)])
      this.pendingToolUses = this.pendingToolUses.filter((t) => !matchIds.has(t.id))
      this.clearUnreadStatus()
    })
  }

  @action async answerQuestion(requestId: string, answers: Record<string, string>): Promise<void> {
    if (!this.service) return
    const question = this.pendingQuestions.find((q) => q.id === requestId)
    const updatedInput = { ...(question?.rawInput ?? {}), answers }
    const answerText = Object.values(answers).join(", ")

    try {
      await this.service.sendToolApproval(this.chat.id, requestId, true, updatedInput)
    } catch (err) {
      console.error("Error sending question answer:", err)
    }
    await this.persistUserMessage(answerText)
    runInAction(() => {
      this.pendingQuestions = this.pendingQuestions.filter((q) => q.id !== requestId)
      this.clearUnreadStatus()
    })
  }

  @action async approvePlan(): Promise<void> {
    if (!this.pendingPlanApproval || !this.service) return
    try {
      await this.service.sendToolApproval(this.chat.id, this.pendingPlanApproval.id, true, {})
    } catch (err) {
      console.error("Error sending plan approval:", err)
    }
    runInAction(() => {
      this.pendingPlanApproval = null
      this.clearUnreadStatus()
    })
  }

  @action async rejectPlan(feedback: string): Promise<void> {
    if (!this.pendingPlanApproval || !this.service) return
    const feedbackMessage = feedback.trim()
      ? `User requested changes to the plan:\n\n${feedback.trim()}`
      : "User rejected the plan"
    // Preserve the current plan content so we can show a diff when the agent revises
    this._lastRejectedPlanContent = this.pendingPlanApproval.planContent
    try {
      await this.service.sendToolApproval(
        this.chat.id,
        this.pendingPlanApproval.id,
        false,
        {},
        feedbackMessage
      )
    } catch (err) {
      console.error("Error sending plan rejection:", err)
    }
    if (feedback.trim()) {
      await this.persistUserMessage(feedback.trim())
    }
    runInAction(() => {
      this.pendingPlanApproval = null
      this.clearUnreadStatus()
    })
  }

  @action async denyPlan(): Promise<void> {
    if (!this.pendingPlanApproval || !this.service) return
    try {
      await this.service.sendToolApproval(
        this.chat.id,
        this.pendingPlanApproval.id,
        false,
        {},
        "User denied the plan. Do not proceed with this plan."
      )
    } catch (err) {
      console.error("Error sending plan denial:", err)
    }
    runInAction(() => {
      this.pendingPlanApproval = null
      this.isSending = false
    })
  }

  @action
  setModelVersion(model: string | null): void {
    this.chat.modelVersion = model
    void this.persistMetadata()
  }

  @action
  setPermissionMode(mode: string | null): void {
    this.chat.permissionMode = mode
    void this.persistMetadata()
  }

  @action
  rename(newLabel: string): void {
    this.chat.label = newLabel
    void this.persistMetadata()
    this.context.saveIndex()
  }

  @action setDraft(text: string): void {
    this.draft = text
    this.persistDraft()
  }

  @action clearUnreadStatus(): void {
    // Clear the persisted "done" status when user views the chat
    // Status is now derived, so we just need to reset the persisted value
    if (this.chat.status === "done") {
      this.chat.status = "idle"
    }
  }

  dispose(): void {
    this.sessionRegistered = false
    this.unsubscribeReconnect?.()
    if (this.boundVisibilityHandler) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler)
    }
    this.seenSeqs.clear()
    void backend.invoke("unregister_chat_session", { chatId: this.chat.id })
  }

  // --- Reconnection and visibility handling ---

  /**
   * Set up reconnection handler for web backend.
   * When WebSocket reconnects, we catch up on any events missed during disconnection.
   */
  private setupReconnectHandler(): void {
    if (backend.type !== "web") return

    // HttpBackend has onReconnect method - use type assertion since Backend interface
    // doesn't include it (it's specific to HttpBackend)
    const httpBackend = backend as { onReconnect?: (cb: () => void) => () => void }
    if (httpBackend.onReconnect) {
      this.unsubscribeReconnect = httpBackend.onReconnect(() => {
        void this.catchUpMissedEvents()
      })
    }
  }

  /**
   * Set up visibility change handler for mobile web.
   * On iOS/mobile, when the app is backgrounded, WebSocket messages may be missed
   * even though the connection stays "open". When the app returns to foreground,
   * we catch up on any missed events.
   */
  private setupVisibilityHandler(): void {
    if (backend.type !== "web") return

    this.boundVisibilityHandler = () => {
      if (document.visibilityState === "visible") {
        // App came back to foreground - catch up on any missed events
        void this.catchUpMissedEvents()
      }
    }

    document.addEventListener("visibilitychange", this.boundVisibilityHandler)
  }

  /**
   * Fetch and replay events that were missed during WebSocket disconnection
   * or while the app was backgrounded.
   *
   * Uses sequence numbers for reliable deduplication:
   * - Each event has a seq (line number in JSONL)
   * - We track seenSeqs to avoid reprocessing events
   * - We track lastSeenSeq to know what to request
   */
  private async catchUpMissedEvents(): Promise<void> {
    if (!this.loaded) return // Not initialized yet, nothing to catch up

    const projectName = this.context.getProjectName()
    const workspaceName = this.context.getWorkspaceName()
    if (!projectName || !workspaceName) return

    try {
      // Fetch events with seq > lastSeenSeq
      const newEvents = await backend.invoke<BackendSeqEvent[]>("load_chat_events_since_seq", {
        projectName,
        workspaceName,
        chatId: this.chat.id,
        sinceSeq: this.lastSeenSeq,
      })

      if (newEvents.length > 0) {
        console.log(
          `[ChatStore] Catching up ${newEvents.length} events (since seq ${this.lastSeenSeq}) for chat ${this.chat.id}`
        )
        runInAction(() => {
          let processedCount = 0
          for (const seqEvent of newEvents) {
            // Skip if we've already processed this seq (deduplication)
            if (this.seenSeqs.has(seqEvent.seq)) {
              continue
            }

            this.seenSeqs.add(seqEvent.seq)
            if (seqEvent.seq > this.lastSeenSeq) {
              this.lastSeenSeq = seqEvent.seq
            }

            const mapped = this.mapRustEvent(seqEvent)
            if (mapped) {
              this.handleAgentEvent(mapped)
              processedCount++
            }
          }

          if (processedCount > 0) {
            console.log(`[ChatStore] Processed ${processedCount} new events after deduplication`)
          }

          // If the last event was turnComplete or done, ensure isSending is reset
          const lastEvent = newEvents[newEvents.length - 1]
          if (lastEvent && (lastEvent.kind === "turnComplete" || lastEvent.kind === "done")) {
            if (this.isSending) {
              this.isSending = false
              this.chat.status = "idle"
            }
          }
        })
      }
    } catch (err) {
      console.error("[ChatStore] Failed to catch up missed events:", err)
    }
  }

  // --- Agent event handling ---

  /**
   * Register callbacks with the agent service.
   * Called during construction (if agent type is set) and when agent type changes.
   * Safe to call multiple times - agent services handle re-registration.
   */
  registerCallbacks(): void {
    if (!this.service) return

    // Attach listeners so we receive events from other clients (e.g., when
    // a different window sends a message and we need to see the userMessage event)
    void this.service.attachListeners(this.chat.id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.service.onEvent(this.chat.id, (eventOrSeqEvent: any) => {
      runInAction(() => {
        // Check if this is a seq event (from HTTP backend - has seq field alongside event fields)
        if (typeof eventOrSeqEvent === "object" && "seq" in eventOrSeqEvent) {
          const seqEvent = eventOrSeqEvent as BackendSeqEvent
          // Deduplicate using seq
          if (this.seenSeqs.has(seqEvent.seq)) {
            return // Already processed
          }
          this.seenSeqs.add(seqEvent.seq)
          if (seqEvent.seq > this.lastSeenSeq) {
            this.lastSeenSeq = seqEvent.seq
          }
          // Map the event (seq is flattened alongside event fields)
          const mapped = this.mapRustEvent(seqEvent)
          if (mapped) {
            this.handleAgentEvent(mapped)
          }
        } else {
          // Direct AgentEvent (from Tauri backend - no seq wrapping)
          this.handleAgentEvent(eventOrSeqEvent as AgentEvent)
        }
      })
    })

    this.service.onDone(this.chat.id, () => {
      runInAction(() => {
        this.isSending = false
        // Show "done" status unless user is actively viewing this chat
        // (both workspace selected AND this chat is active)
        const isViewing =
          this.context.isWorkspaceSelected() && this.context.getActiveChatId() === this.chat.id
        this.chat.status = isViewing ? "idle" : "done"

        // Clear pending follow-ups since the process has exited
        // (they'll be handled by turnComplete if the agent is still responsive)
        this.pendingFollowUps = []
      })
    })
  }

  private handleAgentEvent(event: AgentEvent): void {
    runInAction(() => {
      const messages = this.chat.messages

      switch (event.kind) {
        case "sessionId":
          this.chat.agentSessionId = event.sessionId
          this.service?.setSessionId(this.chat.id, event.sessionId)
          break

        case "message": {
          // Check for overseer action blocks and execute them
          const { cleanContent, actions } = extractOverseerBlocks(event.content)
          if (actions.length > 0) {
            this.executeOverseerActions(actions)
          }
          // Push the message (with or without the overseer blocks removed)
          const contentToShow = actions.length > 0 ? cleanContent : event.content
          if (contentToShow.trim()) {
            this.pushMsg(
              contentToShow,
              event.toolMeta,
              event.isInfo,
              event.parentToolUseId,
              event.toolUseId
            )
          }
          break
        }

        case "userMessage": {
          this.pushUserMsgFromEvent(event)
          break
        }

        case "text": {
          const last = messages[messages.length - 1]
          if (last && last.role === "assistant" && !last.toolMeta && !last.isBashOutput) {
            last.content += event.text
          } else {
            this.pushMsg(event.text)
          }
          break
        }

        case "bashOutput": {
          // Append to existing bash output message or create new one
          const last = messages[messages.length - 1]
          if (last && last.role === "assistant" && last.isBashOutput) {
            last.content += event.text
          } else {
            this.chat.messages.push({
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.text,
              timestamp: new Date(),
              isBashOutput: true,
            })
          }
          break
        }

        case "turnComplete": {
          this.isSending = false
          // Show "done" status unless user is actively viewing this chat
          const isViewing =
            this.context.isWorkspaceSelected() && this.context.getActiveChatId() === this.chat.id
          this.chat.status = isViewing ? "idle" : "done"
          // Check for overseer blocks in messages that were built up via delta streaming
          // (Claude sends complete messages, but Gemini streams deltas that accumulate)
          this.processOverseerBlocksFromRecentMessages()
          // Refresh changed files - the agent may have created/modified/deleted files
          this.context.refreshChangedFiles()

          // Emit turn complete event for other stores to listen to
          eventBus.emit("agent:turnComplete", {
            agentType: this.chat.agentType ?? "claude",
            chatId: this.chat.id,
          })

          // If there are pending follow-ups, combine and send them
          if (this.pendingFollowUps.length > 0) {
            const combinedFollowUp = this.pendingFollowUps.join("\n\n")
            this.pendingFollowUps = []
            const workspacePath = this.context.getWorkspacePath()
            // Small delay ensures MobX reactions have settled
            setTimeout(() => {
              void this.sendMessage(combinedFollowUp, workspacePath)
            }, 100)
          }
          break
        }

        case "toolApproval": {
          // If Rust already auto-approved this tool, don't add to pending
          if (event.autoApproved || event.isProcessed) {
            break
          }
          this.pendingToolUses.push({
            id: event.id,
            name: event.name,
            input: event.displayInput,
            rawInput: event.input,
            commandPrefixes: event.commandPrefixes,
          })
          break
        }

        case "question":
          if (event.isProcessed) {
            break
          }
          this.pendingQuestions.push({
            id: event.id,
            questions: event.questions,
            rawInput: event.rawInput,
          })
          break

        case "planApproval": {
          if (event.isProcessed) {
            break
          }
          // Preserve previous plan content for diff view (null on first submission)
          // Check both current pending approval and rejected plan content
          const previousPlanContent =
            this.pendingPlanApproval?.planContent ?? this._lastRejectedPlanContent ?? null
          // Clear the rejected plan content now that we have a new plan
          this._lastRejectedPlanContent = null
          this.pendingPlanApproval = {
            id: event.id,
            planContent: event.planContent,
            previousPlanContent,
          }
          break
        }

        case "done":
          // Handled by the onDone callback
          break
      }
    })
  }

  private pushMsg(
    content: string,
    toolMeta?: import("../types").ToolMeta,
    isInfo?: boolean,
    parentToolUseId?: string | null,
    toolUseId?: string
  ): void {
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date(),
      ...(toolMeta && { toolMeta }),
      ...(isInfo && { isInfo }),
      ...(parentToolUseId !== undefined && { parentToolUseId }),
      ...(toolUseId && { toolUseId }),
    })
  }

  private pushUserMsg(content: string, meta?: MessageMeta): void {
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
      ...(meta && { meta }),
    })
  }

  private pushUserMsgFromEvent(event: Extract<AgentEvent, { kind: "userMessage" }>): void {
    // Skip if we already have this message by ID
    if (this.chat.messages.some((m) => m.id === event.id)) {
      return
    }

    // Skip system messages (e.g., combined initPrompt + user message sent to the agent)
    if (event.meta?.type === "system") {
      return
    }

    // Also skip if we have a recent user message with the same content
    // (handles the case where frontend adds message locally before backend event arrives)
    const recentMessages = this.chat.messages.slice(-3)
    const hasDuplicate = recentMessages.some(
      (m) => m.role === "user" && m.content === event.content
    )
    if (hasDuplicate) {
      return
    }

    // Mark chat as running if this is a live event (not during initial load)
    // This happens when another client sends a message
    if (this.loaded && !this.loading) {
      this.isSending = true
    }

    this.chat.messages.push({
      id: event.id,
      role: "user",
      content: event.content,
      timestamp: event.timestamp,
      ...(event.meta && { meta: event.meta }),
    })
  }

  /**
   * Check recent assistant messages for overseer blocks that may have been
   * accumulated via delta streaming (Gemini sends deltas, Claude sends complete messages).
   * This is called on turnComplete to ensure blocks spanning multiple deltas are processed.
   */
  private processOverseerBlocksFromRecentMessages(): void {
    const messages = this.chat.messages
    // Check last few assistant messages for overseer blocks
    // We look at messages without toolMeta (text messages, not tool calls)
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 5; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant" || msg.toolMeta || msg.isBashOutput) continue

      const { cleanContent, actions } = extractOverseerBlocks(msg.content)
      if (actions.length > 0) {
        // Update the message content to remove the overseer blocks
        msg.content = cleanContent
        this.executeOverseerActions(actions)
      }
    }
  }

  private executeOverseerActions(actions: OverseerAction[]): void {
    const chatId = this.chat.id

    for (const action of actions) {
      executeOverseerAction(action, {
        chatId,
        renameChat: this.context.renameChat,
      }).catch((err) => {
        console.error("Failed to execute overseer action:", err)
      })
    }
  }

  // --- Private: Persistence ---

  private buildMetadata(): BackendChatMetadata {
    return {
      id: this.chat.id,
      workspaceId: this.chat.workspaceId,
      label: this.chat.label,
      agentType: this.chat.agentType ?? null,
      agentSessionId: this.chat.agentSessionId,
      modelVersion: this.chat.modelVersion,
      permissionMode: this.chat.permissionMode,
      createdAt: this.chat.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  private async ensureSessionRegistered(): Promise<void> {
    if (this.sessionRegistered) return
    const projectName = this.context.getProjectName()
    const workspaceName = this.context.getWorkspaceName()
    if (!projectName || !workspaceName) return

    try {
      await backend.invoke("register_chat_session", {
        chatId: this.chat.id,
        projectName,
        workspaceName,
        metadata: this.buildMetadata(),
      })
      this.sessionRegistered = true
    } catch (err) {
      console.error("Failed to register chat session:", err)
    }
  }

  private async persistMetadata(): Promise<void> {
    const projectName = this.context.getProjectName()
    const workspaceName = this.context.getWorkspaceName()
    if (!projectName || !workspaceName) return

    try {
      await backend.invoke("save_chat_metadata", {
        projectName,
        workspaceName,
        metadata: this.buildMetadata(),
      })
    } catch (err) {
      console.error("Failed to save chat metadata:", err)
    }
  }

  private async persistUserMessage(content: string, meta?: MessageMeta): Promise<void> {
    await this.ensureSessionRegistered()
    let persisted = false

    try {
      const event = await backend.invoke<BackendAgentEvent | null>("add_user_message", {
        chatId: this.chat.id,
        content,
        meta: meta ?? null,
      })
      if (!event) {
        throw new Error("No event returned from add_user_message")
      }
      const mapped = this.mapRustEvent(event)
      if (mapped && mapped.kind === "userMessage") {
        runInAction(() => {
          this.pushUserMsgFromEvent(mapped)
        })
        persisted = true
      }
    } catch (err) {
      console.error("Failed to persist user message:", err)
    }

    if (!persisted) {
      runInAction(() => {
        this.pushUserMsg(content, meta)
      })
    }
  }

  private async persistLocalAssistantMessage(content: string, isInfo?: boolean): Promise<void> {
    await this.ensureSessionRegistered()
    const event: Record<string, unknown> = {
      kind: "message",
      content,
    }
    if (isInfo) {
      event.is_info = true
    }
    try {
      await backend.invoke("append_chat_event", {
        chatId: this.chat.id,
        event,
      })
    } catch (err) {
      console.error("Failed to persist assistant message:", err)
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (this.loaded || this.loading) return
    // If messages already exist from live streaming, skip disk load
    if (this.chat.messages.length > 0) {
      this.loaded = true
      return
    }
    this.loading = true
    try {
      const projectName = this.context.getProjectName()
      const workspaceName = this.context.getWorkspaceName()
      if (!projectName || !workspaceName) {
        console.warn(
          "[ChatStore.loadFromDisk] No project/workspace name available, skipping load",
          {
            chatId: this.chat.id,
            workspacePath: this.context.getWorkspacePath(),
          }
        )
        runInAction(() => {
          this.loaded = true
          this.loading = false
        })
        return
      }

      let metadata: BackendChatMetadata | null = null
      try {
        metadata = await backend.invoke<BackendChatMetadata>("load_chat_metadata", {
          projectName,
          workspaceName,
          chatId: this.chat.id,
        })
      } catch {
        // Metadata doesn't exist yet
      }

      // Load events with sequence numbers for reliable catch-up tracking
      const seqEvents = await backend.invoke<BackendSeqEvent[]>("load_chat_events_with_seq", {
        projectName,
        workspaceName,
        chatId: this.chat.id,
      })

      runInAction(() => {
        if (metadata) {
          if (metadata.label) this.chat.label = metadata.label
          const diskAgentType = metadata.agentType ?? this.chat.agentType ?? "claude"
          const needsReregister = diskAgentType !== this.chat.agentType
          this.chat.agentType = diskAgentType
          this.chat.agentSessionId = metadata.agentSessionId ?? this.chat.agentSessionId
          this.chat.modelVersion = metadata.modelVersion ?? this.chat.modelVersion
          this.chat.permissionMode = metadata.permissionMode ?? this.chat.permissionMode
          if (needsReregister) {
            this.registerCallbacks()
          }
        }

        // Clear and repopulate seenSeqs from disk
        this.seenSeqs.clear()
        this.lastSeenSeq = 0
        for (const seqEvent of seqEvents) {
          this.seenSeqs.add(seqEvent.seq)
          if (seqEvent.seq > this.lastSeenSeq) {
            this.lastSeenSeq = seqEvent.seq
          }
          const mapped = this.mapRustEvent(seqEvent)
          if (mapped) {
            this.handleAgentEvent(mapped)
          }
        }

        if (this.chat.agentSessionId && this.service) {
          this.service.setSessionId(this.chat.id, this.chat.agentSessionId)
        }

        this.loaded = true
        this.loading = false
      })
    } catch (err) {
      console.error("[ChatStore.loadFromDisk] Failed to load chat:", {
        chatId: this.chat.id,
        error: err,
      })
      runInAction(() => {
        this.loaded = true
        this.loading = false
      })
    }
  }

  private mapRustEvent(event: BackendAgentEvent): AgentEvent | null {
    switch (event.kind) {
      case "text":
        if (event.text === undefined) return null
        return { kind: "text", text: event.text }
      case "message": {
        if (!event.content) return null
        const toolMeta = event.tool_meta
          ? {
              toolName: event.tool_meta.tool_name,
              linesAdded: event.tool_meta.lines_added,
              linesRemoved: event.tool_meta.lines_removed,
            }
          : undefined
        return {
          kind: "message",
          content: event.content,
          toolMeta,
          parentToolUseId: event.parent_tool_use_id ?? undefined,
          toolUseId: event.tool_use_id ?? undefined,
          isInfo: event.is_info,
        }
      }
      case "userMessage": {
        if (!event.id || !event.content || !event.timestamp) return null
        return {
          kind: "userMessage",
          id: event.id,
          content: event.content,
          timestamp: new Date(event.timestamp),
          meta: (event.meta as MessageMeta | undefined) ?? undefined,
        }
      }
      case "bashOutput":
        if (event.text === undefined) return null
        return { kind: "bashOutput", text: event.text }
      case "toolApproval":
        return {
          kind: "toolApproval",
          id: event.request_id ?? "",
          name: event.name ?? "",
          input: event.input ?? {},
          displayInput: event.display_input ?? "",
          commandPrefixes: event.prefixes ?? undefined,
          autoApproved: event.auto_approved ?? false,
          isProcessed: event.is_processed ?? false,
        }
      case "question": {
        const questions =
          event.questions?.map((item) => ({
            question: item.question,
            header: item.header,
            options: item.options,
            multiSelect: item.multi_select ?? false,
          })) ?? []
        return {
          kind: "question",
          id: event.request_id ?? "",
          questions,
          rawInput: event.raw_input ?? {},
          isProcessed: event.is_processed ?? false,
        }
      }
      case "planApproval":
        return {
          kind: "planApproval",
          id: event.request_id ?? "",
          planContent: event.content ?? "",
          isProcessed: event.is_processed ?? false,
        }
      case "sessionId":
        if (!event.session_id) return null
        return { kind: "sessionId", sessionId: event.session_id }
      case "turnComplete":
        return { kind: "turnComplete" }
      case "done":
        return { kind: "done" }
      default:
        return null
    }
  }

  // --- Private: Drafts ---

  private loadDraft(): void {
    try {
      const raw = localStorage.getItem("overseer:drafts")
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed[this.chat.id]) {
          this.draft = parsed[this.chat.id]
        }
      }
    } catch {
      // corrupt data — ignore
    }
  }

  private persistDraft(): void {
    try {
      const raw = localStorage.getItem("overseer:drafts")
      const all: Record<string, string> = raw ? JSON.parse(raw) : {}
      if (this.draft) {
        all[this.chat.id] = this.draft
      } else {
        delete all[this.chat.id]
      }
      localStorage.setItem("overseer:drafts", JSON.stringify(all))
    } catch {
      // localStorage full or unavailable — ignore
    }
  }
}
