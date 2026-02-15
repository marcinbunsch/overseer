export interface Project {
  id: string
  name: string
  path: string
  isGitRepo: boolean
  workspaces: Workspace[]
  initPrompt?: string
  prPrompt?: string
  postCreate?: string
  /** Regex pattern to filter out workspaces from the list (matches against path) */
  workspaceFilter?: string
  /** Whether to show GitHub PR buttons for workspaces (default: true) */
  useGithub?: boolean
  /** Whether to show the Merge button for workspaces (default: true) */
  allowMergeToMain?: boolean
}

export interface Workspace {
  id: string
  projectId: string
  branch: string
  path: string
  isArchived: boolean
  isArchiving?: boolean
  isCreating?: boolean
  createdAt: Date
  prNumber?: number
  prUrl?: string
  prState?: "OPEN" | "MERGED" | "CLOSED"
}

export interface Session {
  id: string
  workspaceId: string
  messages: Message[]
  isActive: boolean
  startedAt: Date
}

export interface ToolMeta {
  toolName: string
  linesAdded?: number
  linesRemoved?: number
}

export interface MessageMeta {
  type: string
  label: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  toolMeta?: ToolMeta
  meta?: MessageMeta
  /** True for Codex bash command output - rendered as collapsible */
  isBashOutput?: boolean
  /** True for info messages (e.g., rate limit notifications) - rendered with muted styling */
  isInfo?: boolean
  /** ID of parent Task tool_use - for grouping subagent messages */
  parentToolUseId?: string | null
  /** Tool use ID for Task tools - used to match child messages */
  toolUseId?: string
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionItem {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface AgentQuestion {
  id: string
  questions: QuestionItem[]
  rawInput: Record<string, unknown>
}

// --- Agent Types ---

export type AgentType = "claude" | "codex" | "copilot" | "gemini" | "opencode"

// --- Model selection ---

export interface AgentModel {
  alias: string
  displayName: string
}

// --- Chat Tabs ---

export type ChatStatus = "idle" | "running" | "done" | "needs_attention"

export interface Chat {
  id: string
  workspaceId: string
  label: string
  messages: Message[]
  status: ChatStatus
  agentType?: AgentType // Optional - pending chats have no agent until user selects one
  agentSessionId: string | null
  modelVersion: string | null
  permissionMode: string | null // Claude permission mode (default, acceptEdits, bypassPermissions)
  createdAt: Date
  updatedAt: Date
  isArchived?: boolean
  archivedAt?: Date
}

export interface ChatFile {
  id: string
  workspaceId: string
  label: string
  messages: Message[]
  agentType?: AgentType // Optional for pending chats
  agentSessionId: string | null
  /** @deprecated Use agentSessionId. Kept for backward-compat reading. */
  claudeSessionId?: string | null
  modelVersion?: string | null
  permissionMode?: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatIndexEntry {
  id: string
  label: string
  agentType?: AgentType
  createdAt: string
  updatedAt: string
  isArchived?: boolean
  archivedAt?: string
}

export interface ChatIndex {
  chats: ChatIndexEntry[]
}

/**
 * Workspace-level state stored in workspace.json.
 * Separate from chats.json to keep workspace state distinct from chat list.
 */
export interface WorkspaceState {
  activeChatId: string | null
}

// --- Message Turns ---

export interface MessageTurn {
  /** The user message that starts this turn */
  userMessage: Message
  /** Intermediate assistant messages (tool calls, text) between user msg and final result */
  workMessages: Message[]
  /** The final assistant text response, if the turn is complete */
  resultMessage: Message | null
  /** True if this turn is still streaming / awaiting completion */
  inProgress: boolean
}

// --- Plan Approval ---

export interface PendingPlanApproval {
  id: string
  planContent: string
  /** Previous plan content for showing diff on revisions. Null for first submission. */
  previousPlanContent: string | null
}

// --- Tool Approval ---

export interface PendingToolUse {
  id: string
  name: string
  input: string
  rawInput: Record<string, unknown>
  /** For Bash tools, the command prefixes extracted from the command (handles chained commands) */
  commandPrefixes?: string[]
}

// --- Changed Files ---

export interface ChangedFile {
  status: "M" | "A" | "D" | "R" | "?"
  path: string
  /** True if this is an uncommitted change (staged/unstaged vs HEAD) */
  isUncommitted?: boolean
}

export interface ChangedFilesResult {
  files: ChangedFile[]
  uncommitted: ChangedFile[]
  is_default_branch: boolean
}

// --- Merge ---

export interface MergeResult {
  success: boolean
  conflicts: string[]
  message: string
}
