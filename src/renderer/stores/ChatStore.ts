import { observable, computed, action, makeObservable, runInAction } from "mobx"
import type { Backend } from "../backend/types"
import type {
  Attachment,
  Message,
  MessageMeta,
  MessageTurn,
  Chat,
  ChatStatus,
  AgentQuestion,
  PendingToolUse,
  PendingPlanApproval,
  AgentType,
  AutonomousMessageType,
} from "../types"
import { groupMessagesIntoTurns } from "../utils/groupMessagesIntoTurns"
import { createAgentService } from "../services/agentRegistry"
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
  getBackend: () => Backend
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

export class ChatStore {
  @observable chat: Chat
  @observable isSending: boolean = false
  @observable loading: boolean = false
  @observable pendingToolUses: PendingToolUse[] = []
  @observable pendingQuestions: AgentQuestion[] = []
  @observable pendingPlanApproval: PendingPlanApproval | null = null
  /** Tracks rejected plan content for showing diff when agent revises */
  private _lastRejectedPlanContent: string | null = null
  @observable pendingFollowUps: string[] = []
  @observable draft: string = ""
  @observable loaded: boolean = false

  // Autonomous mode state
  @observable autonomousMode: boolean = false
  @observable autonomousRunning: boolean = false
  @observable autonomousIteration: number = 0
  @observable autonomousMaxIterations: number = 25
  @observable autonomousSessionId: string = ""
  @observable autonomousPhase: "implementation" | "review" = "implementation"
  /** Accumulated text from the current iteration for completion detection */
  private autonomousCurrentIterationText: string = ""
  /** Original permission mode to restore after autonomous run completes. undefined = not set */
  private originalPermissionMode: string | null | undefined = undefined

  private context: ChatStoreContext
  private sessionRegistered: boolean = false
  /** True during loadFromDisk - prevents re-executing overseer actions on replay */
  private isReplaying: boolean = false
  /** Cached agent service instance for this chat */
  private _service: AgentService | null = null
  /** Agent type the cached service was created for */
  private _serviceAgentType: AgentType | undefined = undefined

  constructor(chat: Chat, context: ChatStoreContext) {
    this.chat = chat
    this.context = context
    makeObservable(this)
    this.registerCallbacks()
    this.loadDraft()
  }

  /**
   * Get the backend for this chat (Tauri for local, HTTP for remote workspaces).
   */
  private get backend(): Backend {
    return this.context.getBackend()
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

  /**
   * Get or create the agent service for this chat.
   * Creates a per-chat service instance using the workspace's backend.
   */
  private get service(): AgentService | null {
    if (!this.chat.agentType) return null
    // Re-create service if agent type changed
    if (this._service && this._serviceAgentType !== this.chat.agentType) {
      this._service = null
    }
    if (!this._service) {
      this._service = createAgentService(this.chat.agentType, this.backend)
      this._serviceAgentType = this.chat.agentType
    }
    return this._service
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
    meta?: MessageMeta,
    attachments?: Attachment[]
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

    eventBus.emit("agent:messageSent", {
      agentType: this.chat.agentType ?? "claude",
      chatId: this.chat.id,
    })

    await this.persistUserMessage(content, meta, attachments)
    runInAction(() => {
      this.isSending = true
    })
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

      // Prepend attachment paths to the message so the agent can read the files
      let messageContent = content
      if (attachments && attachments.length > 0) {
        const pathList = attachments.map((a) => `- ${a.path}`).join("\n")
        messageContent = `[Attached files:\n${pathList}]\n\n${content}`
      }

      await this.service.sendMessage(
        this.chat.id,
        messageContent,
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
            await this.backend.invoke("add_approval", {
              projectName,
              toolOrPrefix: prefix,
              isPrefix: true,
            })
          }
        } else {
          console.log("[approveToolUseAll] Adding tool:", tool.name)
          await this.backend.invoke("add_approval", {
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

  /**
   * Add a system info message to the chat.
   * Used for showing workspace setup status, errors, etc.
   */
  @action addSystemMessage(content: string): void {
    this.pushMsg(content, undefined, true)
    void this.persistLocalAssistantMessage(content, true)
  }

  // --- Autonomous Mode ---

  @action
  async startAutonomousRun(prompt: string, maxIterations: number): Promise<void> {
    const workspacePath = this.context.getWorkspacePath()
    if (!workspacePath) return

    // Kill any active generation before starting (e.g. agent waiting in plan mode)
    if (this.isSending || this.pendingPlanApproval) {
      if (this.service) {
        await this.service.interruptTurn(this.chat.id)
      }
      this.pendingPlanApproval = null
      this.pendingToolUses = []
      this.isSending = false
    }

    // Generate unique session ID for this autonomous run
    this.autonomousSessionId = `${this.chat.id}-auto-${Date.now()}`
    this.autonomousMode = true
    this.autonomousRunning = true
    this.autonomousIteration = 0
    this.autonomousMaxIterations = maxIterations
    this.autonomousPhase = "implementation"
    // Save original permission mode to restore after autonomous run completes
    this.originalPermissionMode = this.chat.permissionMode

    // Write the prompt and progress files to workspace
    try {
      await this.backend.invoke("write_file", {
        path: `${workspacePath}/autonomous-prompt.md`,
        content: prompt,
      })
      await this.backend.invoke("write_file", {
        path: `${workspacePath}/autonomous-progress.md`,
        content:
          "# Autonomous Progress\n\nNo progress yet.\n\n> Review findings are stored in `autonomous-review.md`\n",
      })
      await this.backend.invoke("write_file", {
        path: `${workspacePath}/autonomous-review.md`,
        content: "# Autonomous Review\n\nNo review yet.\n",
      })
    } catch (err) {
      console.error("Failed to write autonomous files:", err)
      runInAction(() => {
        this.autonomousMode = false
        this.autonomousRunning = false
      })
      return
    }

    // Add start message
    this.pushAutonomousMessage("autonomous-start", 0)

    // Start first iteration
    await this.runNextIteration()
  }

  @action
  stopAutonomousRun(): void {
    if (!this.autonomousRunning) return

    const stoppedAtIteration = this.autonomousIteration
    this.autonomousRunning = false

    // Restore original permission mode
    if (this.originalPermissionMode !== undefined) {
      this.chat.permissionMode = this.originalPermissionMode
      this.originalPermissionMode = undefined
    }

    // Stop current generation
    this.stopGeneration()

    // Add stopped message
    this.pushAutonomousMessage("autonomous-stopped", stoppedAtIteration)
  }

  @action
  private async runNextIteration(): Promise<void> {
    if (!this.autonomousRunning) return

    // Check iteration limit
    if (this.autonomousIteration >= this.autonomousMaxIterations) {
      this.finishAutonomousRun("Max iterations reached")
      return
    }

    this.autonomousIteration++
    this.autonomousCurrentIterationText = ""

    // Force new session for each iteration by clearing the session ID
    // This ensures Claude CLI starts fresh without trying to --resume
    this.chat.agentSessionId = null
    if (this.service) {
      this.service.setSessionId(this.chat.id, null)
    }

    // Force YOLO mode for autonomous runs (each agent has different YOLO value)
    this.chat.permissionMode = this.getYoloModeValue()

    // Generate and send loop prompt (the message itself serves as the iteration marker)
    const isReview = this.autonomousPhase === "review"
    const loopPrompt = isReview ? this.generateReviewPrompt() : this.generateLoopPrompt()
    const workspacePath = this.context.getWorkspacePath()

    try {
      await this.sendMessage(loopPrompt, workspacePath, {
        type: "system",
        label: isReview ? "Review Step" : "Autonomous Loop",
        autonomousType: "autonomous-loop",
        iteration: this.autonomousIteration,
        maxIterations: this.autonomousMaxIterations,
        phase: this.autonomousPhase,
      })
    } catch (err) {
      console.error("Error in autonomous iteration:", err)
      this.finishAutonomousRun("Error during iteration")
    }
  }

  @action
  private finishAutonomousRun(reason?: string): void {
    this.autonomousRunning = false

    // Restore original permission mode
    if (this.originalPermissionMode !== undefined) {
      this.chat.permissionMode = this.originalPermissionMode
      this.originalPermissionMode = undefined
    }

    this.pushAutonomousMessage("autonomous-complete", this.autonomousIteration, reason)
  }

  /**
   * Returns the appropriate YOLO/auto-approve permission mode value for the current agent type.
   * Each agent has different naming:
   * - Claude: "bypassPermissions"
   * - Codex: "full-auto"
   * - Gemini: "yolo"
   * - Copilot/OpenCode: Don't use permission modes (value ignored)
   */
  private getYoloModeValue(): string {
    const agentType = this.chat.agentType ?? "claude"
    switch (agentType) {
      case "claude":
        return "bypassPermissions"
      case "codex":
        return "full-auto"
      case "gemini":
        return "yolo"
      case "copilot":
      case "opencode":
        // These agents don't use permission modes, but we return a value for consistency
        return "yolo"
      default:
        return "bypassPermissions"
    }
  }

  private generateLoopPrompt(): string {
    return `You are running in **Autonomous Mode**, iteration ${this.autonomousIteration} of max ${this.autonomousMaxIterations}.

## Your Goal
Read the file \`autonomous-prompt.md\` in the workspace root for your full task description.

## Your Progress
Read \`autonomous-progress.md\` to see what has been accomplished so far.

## Your Job This Iteration
1. Study the goal and current progress
2. Execute the NEXT logical step toward completing the goal
3. Update \`autonomous-progress.md\` with what you accomplished

## Important
- Each iteration starts fresh - you have no memory of previous iterations
- Always read the progress file first to understand current state
- Make meaningful progress each iteration, don't just plan
- The progress file is your only way to communicate between iterations
- Do NOT signal completion — a dedicated review step determines when the task is done`
  }

  private generateReviewPrompt(): string {
    return `You are running in **Autonomous Mode**, review step after iteration ${this.autonomousIteration} of max ${this.autonomousMaxIterations}.

## Your Goal
Read \`autonomous-prompt.md\` for the original task description.

## Progress So Far
Read \`autonomous-progress.md\` to see what has been accomplished.

## Your Job: Review
1. Thoroughly review all work done against the original goal
2. Check for correctness, completeness, and quality
3. Write your full review findings to \`autonomous-review.md\`
4. Update \`autonomous-progress.md\` to note that a review was performed and reference \`autonomous-review.md\`

## Decision
- If the goal is **fully and correctly completed**: end your response with exactly: AUTONOMOUS_SESSION_COMPLETE
- If there are remaining issues or incomplete work: describe clearly in \`autonomous-review.md\` what still needs to be done. Do NOT output AUTONOMOUS_SESSION_COMPLETE.

## Important
- Be honest and thorough — this review determines whether the task is done
- Each iteration starts fresh - read the files to understand current state`
  }

  private pushAutonomousMessage(
    autonomousType: AutonomousMessageType,
    iteration: number,
    reason?: string
  ): void {
    let content: string
    switch (autonomousType) {
      case "autonomous-start":
        content = `🚀 **Autonomous Mode Started** — Max ${this.autonomousMaxIterations} iterations`
        break
      case "autonomous-loop":
        content = `🔄 **Iteration ${iteration} of ${this.autonomousMaxIterations}**`
        break
      case "autonomous-complete":
        content = reason
          ? `✅ **Autonomous Mode Complete** — ${reason}`
          : `✅ **Autonomous Mode Complete** — Task finished after ${iteration} iterations`
        break
      case "autonomous-stopped":
        content = `⏹️ **Autonomous Mode Stopped** — Stopped at iteration ${iteration}`
        break
    }
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType,
        iteration,
        maxIterations: this.autonomousMaxIterations,
      },
    })
  }

  /**
   * Called when autonomous mode detects completion.
   * Checks the accumulated text for AUTONOMOUS_SESSION_COMPLETE marker.
   */
  private checkAutonomousCompletion(): void {
    if (!this.autonomousRunning) return

    if (this.autonomousPhase === "implementation") {
      // Implementation done — always move to review next; only review can signal completion
      runInAction(() => {
        this.autonomousPhase = "review"
      })
      void this.runNextIteration()
    } else {
      // Review phase — check for completion signal
      if (this.autonomousCurrentIterationText.includes("AUTONOMOUS_SESSION_COMPLETE")) {
        this.stripCompletionMarkerFromMessages()
        this.finishAutonomousRun("Task completed successfully")
      } else {
        // Review said not done — back to implementation for fixes
        runInAction(() => {
          this.autonomousPhase = "implementation"
        })
        void this.runNextIteration()
      }
    }
  }

  /**
   * Strip AUTONOMOUS_SESSION_COMPLETE marker from recent assistant messages
   * so it doesn't appear in the chat UI.
   */
  @action
  private stripCompletionMarkerFromMessages(): void {
    const messages = this.chat.messages
    // Check last few messages for the marker
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 10; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant" || msg.toolMeta || msg.isBashOutput) continue
      if (msg.content.includes("AUTONOMOUS_SESSION_COMPLETE")) {
        msg.content = msg.content.replace(/\s*AUTONOMOUS_SESSION_COMPLETE\s*/g, "").trim()
      }
    }
  }

  dispose(): void {
    this.sessionRegistered = false
    void this.backend.invoke("unregister_chat_session", { chatId: this.chat.id })
  }

  // --- Agent event handling ---

  /**
   * Register callbacks with the agent service.
   * Called during construction (if agent type is set) and when agent type changes.
   * Safe to call multiple times - agent services handle re-registration.
   */
  registerCallbacks(): void {
    if (!this.service) return
    this.service.onEvent(this.chat.id, (event: AgentEvent) => {
      this.handleAgentEvent(event)
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
          // Check for overseer action blocks and execute them (skip during replay)
          const { cleanContent, actions } = extractOverseerBlocks(event.content)
          if (actions.length > 0 && !this.isReplaying) {
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
          // Track message content for autonomous mode completion detection
          if (this.autonomousRunning && !event.toolMeta) {
            this.autonomousCurrentIterationText += event.content
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
          // Track text for autonomous mode completion detection
          if (this.autonomousRunning) {
            this.autonomousCurrentIterationText += event.text
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

          // Handle autonomous mode - check completion and trigger next iteration
          if (this.autonomousRunning) {
            // Capture current session to detect if user stops during the delay
            const currentSessionId = this.autonomousSessionId
            // Small delay to ensure state is settled before checking
            setTimeout(() => {
              // Only proceed if still running and session hasn't changed
              if (this.autonomousRunning && this.autonomousSessionId === currentSessionId) {
                this.checkAutonomousCompletion()
              }
            }, 500)
            break // Skip normal follow-up handling in autonomous mode
          }

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
    const id = crypto.randomUUID()
    this.chat.messages.push({
      id,
      role: "assistant",
      content,
      timestamp: new Date(),
      ...(toolMeta && { toolMeta }),
      ...(isInfo && { isInfo }),
      ...(parentToolUseId !== undefined && { parentToolUseId }),
      ...(toolUseId && { toolUseId }),
    })
    eventBus.emit("agent:messageReceived", {
      agentType: this.chat.agentType ?? "claude",
      chatId: this.chat.id,
      messageId: id,
    })
  }

  private pushUserMsg(content: string, meta?: MessageMeta, attachments?: Attachment[]): void {
    const id = crypto.randomUUID()
    this.chat.messages.push({
      id,
      role: "user",
      content,
      timestamp: new Date(),
      ...(meta && { meta }),
      ...(attachments?.length && { attachments }),
    })
    eventBus.emit("agent:messageReceived", {
      agentType: this.chat.agentType ?? "claude",
      chatId: this.chat.id,
      messageId: id,
    })
  }

  private pushUserMsgFromEvent(event: Extract<AgentEvent, { kind: "userMessage" }>): void {
    this.chat.messages.push({
      id: event.id,
      role: "user",
      content: event.content,
      timestamp: event.timestamp,
      ...(event.meta && { meta: event.meta }),
      ...(event.attachments?.length && { attachments: event.attachments }),
    })
    eventBus.emit("agent:messageReceived", {
      agentType: this.chat.agentType ?? "claude",
      chatId: this.chat.id,
      messageId: event.id,
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
        // Only execute actions during live streaming, not replay
        if (!this.isReplaying) {
          this.executeOverseerActions(actions)
        }
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
      await this.backend.invoke("register_chat_session", {
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
      await this.backend.invoke("save_chat_metadata", {
        projectName,
        workspaceName,
        metadata: this.buildMetadata(),
      })
    } catch (err) {
      console.error("Failed to save chat metadata:", err)
    }
  }

  private async persistUserMessage(
    content: string,
    meta?: MessageMeta,
    attachments?: Attachment[]
  ): Promise<void> {
    await this.ensureSessionRegistered()
    let persisted = false

    // Store attachments in meta so they survive JSONL persistence/replay
    const metaWithAttachments: Record<string, unknown> | null =
      meta || attachments?.length
        ? { ...(meta ?? {}), ...(attachments?.length ? { attachments } : {}) }
        : null

    try {
      const event = await this.backend.invoke<BackendAgentEvent | null>("add_user_message", {
        chatId: this.chat.id,
        content,
        meta: metaWithAttachments,
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
        this.pushUserMsg(content, meta, attachments)
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
      await this.backend.invoke("append_chat_event", {
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
        metadata = await this.backend.invoke<BackendChatMetadata>("load_chat_metadata", {
          projectName,
          workspaceName,
          chatId: this.chat.id,
        })
      } catch {
        // Metadata doesn't exist yet
      }

      const events = await this.backend.invoke<BackendAgentEvent[]>("load_chat_events", {
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

        // Set replaying flag to prevent re-executing overseer actions
        this.isReplaying = true
        for (const event of events) {
          const mapped = this.mapRustEvent(event)
          if (mapped) {
            this.handleAgentEvent(mapped)
          }
        }
        this.isReplaying = false

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
        const rawMeta = event.meta as Record<string, unknown> | undefined
        // Extract attachments stored in meta (if any)
        const attachments =
          rawMeta?.attachments && Array.isArray(rawMeta.attachments)
            ? (rawMeta.attachments as Attachment[])
            : undefined
        // Reconstruct meta without the attachments field
        let meta: MessageMeta | undefined
        if (rawMeta) {
          const { attachments: _a, ...restMeta } = rawMeta
          if (Object.keys(restMeta).length > 0) {
            meta = restMeta as unknown as MessageMeta
          }
        }
        return {
          kind: "userMessage",
          id: event.id,
          content: event.content,
          timestamp: new Date(event.timestamp),
          meta,
          attachments,
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
