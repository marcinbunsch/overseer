import { observable, computed, action, makeObservable, runInAction } from "mobx"
import type {
  Message,
  MessageMeta,
  MessageTurn,
  Chat,
  ChatIndex,
  WorkspaceState,
  AgentQuestion,
  PendingToolUse,
  PendingPlanApproval,
  AgentType,
  Workspace,
} from "../types"
import { getAgentService } from "../services/agentRegistry"
import { ChatStore, type ChatStoreContext } from "./ChatStore"
import { ChangedFilesStore } from "./ChangedFilesStore"
import { configStore } from "./ConfigStore"
import { getAgentDisplayName } from "../utils/agentDisplayName"
import { toastStore } from "./ToastStore"
import { projectRegistry } from "./ProjectRegistry"
import { backend } from "../backend"
import { getConfigPath } from "../utils/paths"

export type { PendingToolUse } from "../types"

/**
 * Instructions for agents to use Overseer actions.
 * Appended to the init prompt for all chats.
 */
const OVERSEER_ACTIONS_PROMPT = `
## Overseer Actions

You are running inside Overseer, a desktop app for AI coding agents. You can trigger actions in Overseer by outputting a fenced code block with language "overseer". Output this directly as text in your response — do NOT use Bash, echo, or any tool to output it:

\`\`\`overseer
{"action": "<action_name>", "params": {...}}
\`\`\`

Available actions:
- \`rename_chat\` - Set the chat title. Params: \`title\` (string). Use this after understanding the user's task to give the chat a descriptive name.
- \`open_pr\` - Create a GitHub PR. Params: \`title\` (string, required), \`body\` (string, optional)
- \`merge_branch\` - Merge current branch. Params: \`into\` (string, target branch)

When asked to merge a branch, use the merge_branch overseer action instead of running git commands directly.
`.trim()

export type WorkspaceStatus = "idle" | "running" | "needs_attention" | "done"

/**
 * WorkspaceStore manages chat state for a single workspace.
 * Each workspace has its own set of chats, active chat, and tool approvals.
 */
export class WorkspaceStore {
  // Identity - from Workspace data
  readonly id: string
  readonly projectId: string
  readonly branch: string
  readonly path: string

  // Reference to parent project name (for persistence paths)
  private projectName: string

  // Chat management
  @observable
  private _chats: ChatStore[] = []

  @observable
  activeChatId: string | null = null

  @observable
  loading: boolean = false

  @observable
  loaded: boolean = false

  // Init prompt from project
  private initPrompt?: string

  // Cached ChangedFilesStore - created lazily
  private _changedFilesStore: ChangedFilesStore | null = null

  constructor(workspace: Workspace, projectName: string, initPrompt?: string) {
    this.id = workspace.id
    this.projectId = workspace.projectId
    this.branch = workspace.branch
    this.path = workspace.path
    this.projectName = projectName
    this.initPrompt = initPrompt
    makeObservable(this)

    // Debug: warn if workspace has empty path
    if (!workspace.path) {
      console.error("[WorkspaceStore] Created with empty path!", {
        workspaceId: workspace.id,
        projectId: workspace.projectId,
        branch: workspace.branch,
        projectName,
      })
    }
  }

  // --- Computed properties ---

  /**
   * Get the ProjectStore for this workspace.
   * Used to access project-level approvals.
   */
  private get projectStore() {
    return projectRegistry.getProjectStore(this.projectId)
  }

  @computed
  get activeChat(): ChatStore | null {
    if (!this.activeChatId) return null
    return this._chats.find((c) => c.id === this.activeChatId && !c.chat.isArchived) ?? null
  }

  /** Active (non-archived) chats */
  @computed
  get activeChats(): ChatStore[] {
    return this._chats.filter((c) => !c.chat.isArchived)
  }

  /** Archived chats, sorted by archivedAt descending (most recent first) */
  @computed
  get archivedChats(): ChatStore[] {
    return this._chats
      .filter((c) => c.chat.isArchived)
      .sort((a, b) => {
        const aTime = a.chat.archivedAt?.getTime() ?? 0
        const bTime = b.chat.archivedAt?.getTime() ?? 0
        return bTime - aTime
      })
  }

  /** All chats (for flushing to disk on window close) */
  get allChats(): ChatStore[] {
    return this._chats
  }

  /** Whether there are any archived chats */
  @computed
  get hasArchivedChats(): boolean {
    return this.archivedChats.length > 0
  }

  @computed
  get currentMessages(): Message[] {
    return this.activeChat?.messages ?? []
  }

  @computed
  get currentTurns(): MessageTurn[] {
    return this.activeChat?.turns ?? []
  }

  @computed
  get isSending(): boolean {
    return this.activeChat?.isSending ?? false
  }

  @computed
  get pendingToolUses(): PendingToolUse[] {
    return this.activeChat?.pendingToolUses ?? []
  }

  @computed
  get pendingQuestions(): AgentQuestion[] {
    return this.activeChat?.pendingQuestions ?? []
  }

  @computed
  get pendingPlanApproval(): PendingPlanApproval | null {
    return this.activeChat?.pendingPlanApproval ?? null
  }

  @computed
  get pendingFollowUps(): string[] {
    return this.activeChat?.pendingFollowUps ?? []
  }

  /** Aggregate status across all chats for this workspace */
  @computed
  get status(): WorkspaceStatus {
    if (this._chats.length === 0) return "idle"
    let hasDone = false
    for (const cs of this._chats) {
      if (cs.status === "needs_attention") return "needs_attention"
      if (cs.status === "running") return "running"
      if (cs.status === "done") hasDone = true
    }
    return hasDone ? "done" : "idle"
  }

  /** Get the current draft for the active chat */
  @computed
  get currentDraft(): string {
    return this.activeChat?.draft ?? ""
  }

  /** Count of chats currently running */
  @computed
  get runningCount(): number {
    return this.activeChats.filter((cs) => cs.chat.status === "running").length
  }

  getDraft(chatId: string): string {
    const store = this._chats.find((c) => c.id === chatId)
    return store?.draft ?? ""
  }

  /**
   * Get or create the ChangedFilesStore for this workspace.
   * The store is cached and reused across workspace switches.
   */
  getChangedFilesStore(): ChangedFilesStore {
    if (!this._changedFilesStore) {
      this._changedFilesStore = new ChangedFilesStore(this.path, this.id)
    }
    return this._changedFilesStore
  }

  async getChatLogPath(chatId: string): Promise<string | null> {
    const chatDir = await this.getChatDir()
    if (!chatDir) return null
    return `${chatDir}/${chatId}.json`
  }

  @action
  setDraft(chatId: string, text: string): void {
    const store = this._chats.find((c) => c.id === chatId)
    if (store) store.setDraft(text)
  }

  // --- Actions ---

  @action
  async load(): Promise<void> {
    // If already loaded, just ensure active chat is ready
    if (this.loaded) {
      const active = this._chats.find((c) => c.id === this.activeChatId)
      if (active) {
        active.clearUnreadStatus()
        active.ensureLoaded()
      }
      return
    }

    if (this.loading) return

    this.loading = true
    await this.loadChatsFromDisk()
    // Load project-level approvals (shared across all workspaces)
    await this.projectStore?.loadApprovals()
    runInAction(() => {
      this.loading = false
      this.loaded = true
    })
  }

  @action
  newChat(agentType?: AgentType): void {
    const label = agentType ? this.getDefaultChatLabel(agentType) : "New Chat"
    const store = this.createChatStore(label, agentType)
    store.loaded = true // new chat, nothing to load
    this._chats.push(store)
    this.activeChatId = store.id
    this.saveIndex()
    store.saveToDisk()
  }

  /**
   * Set the agent type for a pending chat (one created without an agent).
   * This is called when user selects an agent in the NewChatScreen for a pending chat.
   */
  @action
  setActiveChatAgent(agentType: AgentType): void {
    const chat = this.activeChat
    if (!chat) return

    const defaultModel = configStore.getDefaultModelForAgent(agentType)
    chat.chat.agentType = agentType
    chat.chat.label = this.getDefaultChatLabel(agentType)
    chat.chat.modelVersion = defaultModel
    // Register callbacks now that agent type is set (was skipped in constructor)
    chat.registerCallbacks()
    chat.saveToDisk()
    this.saveIndex()
  }

  @action
  switchChat(chatId: string): void {
    const store = this._chats.find((c) => c.id === chatId)
    if (store) {
      store.clearUnreadStatus()
      store.ensureLoaded()
    }
    this.activeChatId = chatId
  }

  @action
  selectPreviousChat(): void {
    if (!this.activeChatId) return
    const chats = this.activeChats
    if (chats.length <= 1) return

    const currentIdx = chats.findIndex((c) => c.id === this.activeChatId)
    if (currentIdx < 0) return

    const newIdx = currentIdx === 0 ? chats.length - 1 : currentIdx - 1
    this.switchChat(chats[newIdx].id)
  }

  @action
  selectNextChat(): void {
    if (!this.activeChatId) return
    const chats = this.activeChats
    if (chats.length <= 1) return

    const currentIdx = chats.findIndex((c) => c.id === this.activeChatId)
    if (currentIdx < 0) return

    const newIdx = currentIdx === chats.length - 1 ? 0 : currentIdx + 1
    this.switchChat(chats[newIdx].id)
  }

  /**
   * Archive a single chat by marking it as archived.
   */
  @action
  async archiveChat(chatId: string): Promise<void> {
    const chatStore = this._chats.find((c) => c.id === chatId)
    if (!chatStore) return

    // Stop the agent process if running
    if (chatStore.chat.agentType) {
      const service = getAgentService(chatStore.chat.agentType)
      service.stopChat(chatId)
      service.removeChat(chatId)
    }

    // Mark as archived
    chatStore.chat.isArchived = true
    chatStore.chat.archivedAt = new Date()

    // If we archived the active tab, switch to another active chat or clear activeChatId
    if (this.activeChatId === chatId) {
      const chats = this.activeChats
      if (chats.length === 0) {
        this.activeChatId = null
      } else {
        this.activeChatId = chats[0].id
      }
    }

    this.saveIndex()
    chatStore.saveToDisk()
  }

  /**
   * Permanently delete a chat and its file from disk.
   */
  @action
  async deleteChat(chatId: string): Promise<void> {
    const chatStore = this._chats.find((c) => c.id === chatId)
    if (!chatStore) return

    // Stop the agent process if running
    if (chatStore.chat.agentType) {
      const service = getAgentService(chatStore.chat.agentType)
      service.stopChat(chatId)
      service.removeChat(chatId)
    }

    // Remove from array
    const idx = this._chats.findIndex((c) => c.id === chatId)
    if (idx >= 0) {
      this._chats.splice(idx, 1)
    }

    // If we deleted the active tab, switch to another active chat
    if (this.activeChatId === chatId) {
      const chats = this.activeChats
      this.activeChatId = chats.length > 0 ? chats[0].id : null
    }

    // Delete the chat file from disk
    try {
      await backend.invoke("delete_chat", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
        chatId,
      })
    } catch (err) {
      console.error("Failed to delete chat file:", err)
    }

    // Save updated index
    await this.saveIndex()
  }

  @action
  renameChat(chatId: string, newLabel: string): void {
    const store = this._chats.find((c) => c.id === chatId)
    if (store) store.rename(newLabel)
  }

  // --- Delegate actions to active chat ---

  @action
  async sendMessage(content: string, meta?: MessageMeta): Promise<void> {
    const active = this.activeChat
    if (!active) return

    // Debug: warn if path is empty
    if (!this.path) {
      console.error("[WorkspaceStore.sendMessage] Path is empty!", {
        workspaceId: this.id,
        projectId: this.projectId,
        branch: this.branch,
        activeChatId: this.activeChatId,
      })
    }

    await active.sendMessage(content, this.path, meta)
  }

  @action
  stopGeneration(): void {
    this.activeChat?.stopGeneration()
  }

  @action
  clearPendingFollowUps(): void {
    this.activeChat?.clearPendingFollowUps()
  }

  @action
  removeFollowUp(index: number): void {
    this.activeChat?.removeFollowUp(index)
  }

  @action
  async approveToolUse(toolId: string, approved: boolean): Promise<void> {
    await this.activeChat?.approveToolUse(toolId, approved)
  }

  @action
  async approveToolUseAll(toolId: string, scope: "tool" | "command" = "tool"): Promise<void> {
    await this.activeChat?.approveToolUseAll(toolId, scope)
  }

  @action
  async denyToolUseWithExplanation(toolId: string, explanation: string): Promise<void> {
    await this.activeChat?.denyToolUseWithExplanation(toolId, explanation)
  }

  @action
  async answerQuestion(requestId: string, answers: Record<string, string>): Promise<void> {
    await this.activeChat?.answerQuestion(requestId, answers)
  }

  @action
  async approvePlan(): Promise<void> {
    await this.activeChat?.approvePlan()
  }

  @action
  async rejectPlan(feedback: string): Promise<void> {
    await this.activeChat?.rejectPlan(feedback)
  }

  @action
  async denyPlan(): Promise<void> {
    await this.activeChat?.denyPlan()
  }

  @action
  setModelVersion(model: string | null): void {
    this.activeChat?.setModelVersion(model)
  }

  @action
  setPermissionMode(mode: string | null): void {
    this.activeChat?.setPermissionMode(mode)
  }

  // --- Internal helpers ---

  private createChatContext(): ChatStoreContext {
    return {
      getChatDir: () => this.getChatDir(),
      getInitPrompt: () => this.buildInitPrompt(),
      getProjectName: () => this.projectName,
      getWorkspaceName: () => this.path.split("/").pop() || "unknown",
      saveIndex: () => this.saveChatIndex(),
      getActiveChatId: () => this.activeChatId,
      getWorkspacePath: () => this.path,
      renameChat: (chatId: string, newLabel: string) => this.renameChat(chatId, newLabel),
      isWorkspaceSelected: () => projectRegistry.selectedWorkspaceId === this.id,
      refreshChangedFiles: () => void this._changedFilesStore?.refresh(),
    }
  }

  private buildInitPrompt(): string | undefined {
    // Always include overseer actions instructions
    if (this.initPrompt) {
      return `${this.initPrompt}\n\n${OVERSEER_ACTIONS_PROMPT}`
    }
    return OVERSEER_ACTIONS_PROMPT
  }

  private createChatStore(label: string, agentType?: AgentType): ChatStore {
    const now = new Date()
    const defaultModel = agentType ? configStore.getDefaultModelForAgent(agentType) : null
    const chat: Chat = {
      id: crypto.randomUUID(),
      workspaceId: this.id,
      label,
      messages: [],
      status: "idle",
      agentType,
      agentSessionId: null,
      modelVersion: defaultModel,
      permissionMode: null,
      createdAt: now,
      updatedAt: now,
    }
    return new ChatStore(chat, this.createChatContext())
  }

  /**
   * Move this workspace's chat folder to the archived directory so that
   * a future workspace with the same animal name starts with a clean slate.
   * Destination: ~/.config/overseer[-dev]/chats/{repoName}.archived/{branch}-YYYY-MM-DD-HH-MM-SS
   */
  async archiveChatFolder(): Promise<void> {
    try {
      const now = new Date()
      const ts = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("-")

      const safeBranch = this.branch.replace(/\//g, "-")
      const archiveName = `${safeBranch}-${ts}`

      await backend.invoke("archive_chat_dir", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
        archiveName,
      })
    } catch (err) {
      console.error("Failed to archive chat folder:", err)
    }
  }

  // --- Persistence ---

  private getWorkspaceName(): string {
    return this.path.split("/").pop() || "unknown"
  }

  private async getChatDir(): Promise<string | null> {
    if (!this.projectName || !this.path) return null
    // Return a placeholder - this is only used for logging now
    try {
      const homeDir = await backend.invoke<string>("get_home_dir")
      const normalizedHome = homeDir.replace(/\/$/, "")
      const configDir = getConfigPath(normalizedHome)
      return `${configDir}/chats/${this.projectName}/${this.getWorkspaceName()}`
    } catch (err) {
      console.error("Failed to resolve home dir for chat path:", err)
      return null
    }
  }

  private async loadChatsFromDisk(): Promise<void> {
    try {
      const projectName = this.projectName
      const workspaceName = this.getWorkspaceName()

      // Ensure chat directory exists
      await backend.invoke("ensure_chat_dir", { projectName, workspaceName })

      // Load workspace state (activeChatId)
      const workspaceState = await this.loadWorkspaceState()

      // Load chat index
      const chatIndex = await this.loadChatIndex()

      // Get list of actual chat files to validate index
      const chatIds = await backend.invoke<string[]>("list_chat_ids", {
        projectName,
        workspaceName,
      })
      const chatIdSet = new Set(chatIds)

      const context = this.createChatContext()
      const loaded: ChatStore[] = []

      for (const entry of chatIndex.chats) {
        if (!chatIdSet.has(entry.id)) continue

        // Create skeleton chat — messages loaded lazily
        const chat: Chat = {
          id: entry.id,
          workspaceId: this.id,
          label: entry.label,
          messages: [],
          status: "idle",
          agentType: entry.agentType ?? "claude",
          agentSessionId: null,
          modelVersion: null,
          permissionMode: null,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.updatedAt),
          isArchived: entry.isArchived ?? false,
          archivedAt: entry.archivedAt ? new Date(entry.archivedAt) : undefined,
        }
        const store = new ChatStore(chat, context)
        loaded.push(store)
      }

      let createdDefault = false
      runInAction(() => {
        // Check if we have any active (non-archived) chats
        const activeChats = loaded.filter((c) => !c.chat.isArchived)
        if (activeChats.length === 0 && configStore.defaultAgent) {
          // Create a default chat using the configured default agent
          const agent = configStore.defaultAgent
          const newStore = this.createChatStore(this.getDefaultChatLabel(agent), agent)
          newStore.loaded = true
          loaded.push(newStore)
          createdDefault = true
        }
        this._chats = loaded

        // Set active chat to the saved one or first active chat
        const activeId =
          workspaceState.activeChatId ?? loaded.filter((c) => !c.chat.isArchived)[0]?.id ?? null
        this.activeChatId = activeId

        // Eagerly load the active chat
        const activeStore = loaded.find((s) => s.id === activeId)
        if (activeStore) activeStore.ensureLoaded()

        // Check if any chats have running processes
        for (const cs of loaded) {
          if (cs.chat.agentType) {
            const service = getAgentService(cs.chat.agentType)
            if (service.isRunning(cs.id)) {
              cs.chat.status = "running"
            }
          }
        }
      })

      // Only save if we created a new default chat
      if (createdDefault) {
        this.saveWorkspaceState()
        this.saveChatIndex()
        const newChat = loaded[loaded.length - 1]
        if (newChat?.loaded) {
          newChat.saveToDisk()
        }
      }
    } catch (err) {
      console.error("Failed to load chats from disk:", err)
      runInAction(() => {
        const agent = configStore.defaultAgent
        if (agent) {
          const newStore = this.createChatStore(this.getDefaultChatLabel(agent), agent)
          newStore.loaded = true
          this._chats = [newStore]
          this.activeChatId = newStore.id
        } else {
          // No default agent - start with empty chat list (shows NewChatScreen)
          this._chats = []
          this.activeChatId = null
        }
      })
    }
  }

  /**
   * Load workspace state from workspace.json.
   */
  private async loadWorkspaceState(): Promise<WorkspaceState> {
    try {
      return await backend.invoke<WorkspaceState>("load_workspace_state", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
      })
    } catch {
      return { activeChatId: null }
    }
  }

  /**
   * Load chat index from chats.json.
   */
  private async loadChatIndex(): Promise<ChatIndex> {
    try {
      return await backend.invoke<ChatIndex>("load_chat_index", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
      })
    } catch {
      return { chats: [] }
    }
  }

  private getDefaultChatLabel(agentType: AgentType): string {
    return getAgentDisplayName(agentType)
  }

  private async saveIndex(): Promise<void> {
    await this.saveWorkspaceState()
    await this.saveChatIndex()
  }

  private async saveWorkspaceState(): Promise<void> {
    try {
      const state: WorkspaceState = {
        activeChatId: this.activeChatId,
      }
      await backend.invoke("save_workspace_state", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
        workspaceState: state,
      })
    } catch (err) {
      console.error("Failed to save workspace state:", err)
      toastStore.show("Failed to save workspace state")
    }
  }

  private async saveChatIndex(): Promise<void> {
    try {
      const index: ChatIndex = {
        chats: this._chats.map((cs) => ({
          id: cs.id,
          label: cs.label,
          agentType: cs.chat.agentType,
          createdAt: cs.chat.createdAt.toISOString(),
          updatedAt: cs.chat.updatedAt.toISOString(),
          isArchived: cs.chat.isArchived,
          archivedAt: cs.chat.archivedAt?.toISOString(),
        })),
      }
      await backend.invoke("save_chat_index", {
        projectName: this.projectName,
        workspaceName: this.getWorkspaceName(),
        index,
      })
    } catch (err) {
      console.error("Failed to save chat index:", err)
    }
  }

  /**
   * Reopen an archived chat by marking it as not archived.
   */
  @action
  async reopenArchivedChat(chatId: string): Promise<void> {
    const chatStore = this._chats.find((c) => c.id === chatId)
    if (!chatStore || !chatStore.chat.isArchived) return

    // Mark as not archived
    chatStore.chat.isArchived = false
    chatStore.chat.archivedAt = undefined
    this.activeChatId = chatId

    // Ensure it's loaded
    await chatStore.ensureLoaded()

    this.saveIndex()
    chatStore.saveToDisk()
  }

  dispose(): void {
    for (const cs of this._chats) {
      cs.dispose()
    }
    this._chats = []
    this._changedFilesStore?.dispose()
    this._changedFilesStore = null
  }
}
