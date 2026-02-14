import { observable, computed, action, makeObservable, runInAction } from "mobx"
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs"
import type {
  Message,
  MessageMeta,
  MessageTurn,
  Chat,
  ChatFile,
  ChatStatus,
  AgentQuestion,
  PendingToolUse,
  PendingPlanApproval,
  AgentType,
} from "../types"
import { areCommandsSafe } from "../types"
import { groupMessagesIntoTurns } from "../utils/groupMessagesIntoTurns"
import { getAgentService } from "../services/agentRegistry"
import type { AgentEvent, AgentService } from "../services/types"
import { configStore } from "./ConfigStore"
import { extractOverseerBlocks, type OverseerAction } from "../utils/overseerActions"
import { executeOverseerAction } from "../services/overseerActionExecutor"

export interface ChatStoreContext {
  getChatDir: () => Promise<string | null>
  getInitPrompt: () => string | undefined
  getApprovedToolNames: () => Set<string>
  getApprovedCommandPrefixes: () => Set<string>
  addApprovedToolName: (name: string) => void
  addApprovedCommandPrefix: (prefix: string) => void
  saveApprovals: () => void
  saveIndex: () => void
  getActiveChatId: () => string | null
  getWorkspacePath: () => string
  renameChat: (chatId: string, newLabel: string) => void
  isWorkspaceSelected: () => boolean
  refreshChangedFiles: () => void
}

export class ChatStore {
  @observable chat: Chat
  @observable isSending: boolean = false
  @observable pendingToolUses: PendingToolUse[] = []
  @observable pendingQuestions: AgentQuestion[] = []
  @observable pendingPlanApproval: PendingPlanApproval | null = null
  @observable pendingFollowUps: string[] = []
  @observable draft: string = ""
  @observable loaded: boolean = false

  private context: ChatStoreContext
  private loading: boolean = false
  private saveTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(chat: Chat, context: ChatStoreContext) {
    this.chat = chat
    this.context = context
    makeObservable(this)
    this.registerCallbacks()
    this.loadDraft()
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
    const initPrompt = isFirstMessage ? this.context?.getInitPrompt() : undefined

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
      ...(meta && { meta }),
    }

    this.chat.messages.push(userMessage)
    this.isSending = true
    this.setDraft("")
    this.scheduleSave()

    try {
      const logDir = (await this.context?.getChatDir()) ?? undefined
      // Use chat's permission mode if set, otherwise fall back to global config
      const permissionMode =
        this.chat.agentType === "claude"
          ? (this.chat.permissionMode ?? configStore.claudePermissionMode)
          : this.chat.agentType === "codex"
            ? configStore.codexApprovalPolicy
            : null
      await this.service.sendMessage(
        this.chat.id,
        content,
        workspacePath,
        logDir,
        this.chat.modelVersion,
        permissionMode,
        initPrompt
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
        this.scheduleSave()
      })
    }
  }

  @action stopGeneration(): void {
    if (!this.service) return
    this.service.stopChat(this.chat.id)
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "[cancelled]",
      timestamp: new Date(),
    })
    this.isSending = false
    this.pendingFollowUps = []
    this.scheduleSave()
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

  @action async approveToolUseAll(
    toolId: string,
    scope: "tool" | "command" = "tool"
  ): Promise<void> {
    if (!this.service) return
    const tool = this.pendingToolUses.find((t) => t.id === toolId)
    if (tool) {
      if (scope === "command" && tool.commandPrefixes?.length) {
        // Add all prefixes from this command (handles chained commands)
        for (const prefix of tool.commandPrefixes) {
          this.context.addApprovedCommandPrefix(prefix)
        }
      } else {
        this.context.addApprovedToolName(tool.name)
      }
      this.context.saveApprovals()
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
      const matches = this.pendingToolUses.filter((t) => {
        if (t.id === toolId) return false
        if (scope === "command" && tool.commandPrefixes?.length) {
          // Check if all prefixes in this tool are approved
          return (
            t.name === "Bash" &&
            t.commandPrefixes?.length &&
            t.commandPrefixes.every((p) => this.context.getApprovedCommandPrefixes().has(p))
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
    runInAction(() => {
      this.pendingQuestions = this.pendingQuestions.filter((q) => q.id !== requestId)
      this.clearUnreadStatus()
      this.chat.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content: answerText,
        timestamp: new Date(),
      })
      this.scheduleSave()
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
    runInAction(() => {
      this.pendingPlanApproval = null
      this.clearUnreadStatus()
      if (feedback.trim()) {
        this.chat.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: feedback.trim(),
          timestamp: new Date(),
        })
        this.scheduleSave()
      }
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
    this.scheduleSave()
  }

  @action
  setPermissionMode(mode: string | null): void {
    this.chat.permissionMode = mode
    this.scheduleSave()
  }

  @action
  rename(newLabel: string): void {
    this.chat.label = newLabel
    this.saveToDisk()
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
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }
    this.saveToDisk()
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
        // Cancel any scheduled save and save immediately
        if (this.saveTimeout) {
          clearTimeout(this.saveTimeout)
          this.saveTimeout = null
        }
        void this.saveToDisk()

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
            this.pushMsg(contentToShow, event.toolMeta, event.isInfo)
          }
          this.scheduleSave()
          break
        }

        case "text": {
          const last = messages[messages.length - 1]
          if (last && last.role === "assistant" && !last.toolMeta && !last.isBashOutput) {
            last.content += event.text
          } else {
            this.pushMsg(event.text)
          }
          this.scheduleSave()
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
          // Immediate save - cancel any scheduled save and save now
          if (this.saveTimeout) {
            clearTimeout(this.saveTimeout)
            this.saveTimeout = null
          }
          void this.saveToDisk()

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
          // Auto-approve if user previously chose "Approve All Like This"
          const approvedTools = this.context.getApprovedToolNames()
          const approvedPrefixes = this.context.getApprovedCommandPrefixes()

          // Check if all commands are safe (read-only operations)
          const isSafeCommand = areCommandsSafe(event.commandPrefixes)

          // For Bash commands with chained commands, ALL prefixes must be approved
          const allPrefixesApproved =
            event.name === "Bash" &&
            event.commandPrefixes?.length &&
            event.commandPrefixes.every((p) => approvedPrefixes.has(p))

          const autoApproved = approvedTools.has(event.name) || allPrefixesApproved || isSafeCommand

          if (autoApproved && this.service) {
            this.service.sendToolApproval(this.chat.id, event.id, true, event.input)
            return
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
          this.pendingQuestions.push({
            id: event.id,
            questions: event.questions,
            rawInput: event.rawInput,
          })
          break

        case "planApproval":
          this.pendingPlanApproval = {
            id: event.id,
            planContent: event.planContent,
          }
          break

        case "done":
          // Handled by the onDone callback
          break
      }
    })
  }

  private pushMsg(content: string, toolMeta?: import("../types").ToolMeta, isInfo?: boolean): void {
    this.chat.messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date(),
      ...(toolMeta && { toolMeta }),
      ...(isInfo && { isInfo }),
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

  private scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => this.saveToDisk(), 1000)
  }

  async saveToDisk(): Promise<void> {
    const chatDir = await this.context.getChatDir()
    if (!chatDir) return

    try {
      const chat = this.chat
      const file: ChatFile = {
        id: chat.id,
        workspaceId: chat.workspaceId,
        label: chat.label,
        messages: chat.messages,
        agentType: chat.agentType,
        agentSessionId: chat.agentSessionId,
        modelVersion: chat.modelVersion,
        permissionMode: chat.permissionMode,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await writeTextFile(`${chatDir}/${chat.id}.json`, JSON.stringify(file, null, 2) + "\n")
    } catch (err) {
      console.error("Failed to save chat to disk:", err)
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
      const chatDir = await this.context.getChatDir()
      if (!chatDir) {
        console.warn("[ChatStore.loadFromDisk] No chat dir available, skipping load", {
          chatId: this.chat.id,
          workspacePath: this.context.getWorkspacePath(),
        })
        runInAction(() => {
          this.loaded = true
          this.loading = false
        })
        return
      }
      const filePath = `${chatDir}/${this.chat.id}.json`
      const fileExists = await exists(filePath)
      if (!fileExists) {
        runInAction(() => {
          this.loaded = true
          this.loading = false
        })
        return
      }

      const raw = await readTextFile(filePath)
      const file = JSON.parse(raw) as ChatFile

      runInAction(() => {
        this.chat.messages = file.messages.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }))
        // Backward compat: read claudeSessionId if agentSessionId not present
        const sessionId = file.agentSessionId ?? file.claudeSessionId ?? null
        this.chat.agentSessionId = sessionId
        this.chat.modelVersion = file.modelVersion ?? null
        this.chat.permissionMode = file.permissionMode ?? null
        // Read agentType with fallback to claude
        const diskAgentType = file.agentType ?? "claude"
        const needsReregister = diskAgentType !== this.chat.agentType
        this.chat.agentType = diskAgentType
        if (needsReregister) {
          this.registerCallbacks()
        }
        if (sessionId && this.service) {
          this.service.setSessionId(this.chat.id, sessionId)
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
