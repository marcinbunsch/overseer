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

/**
 * Commands that take arguments directly (use first word only for prefix).
 * These don't have subcommands - their second "word" is an argument.
 */
const SINGLE_WORD_COMMANDS = new Set([
  // Shell/scripting
  "cd",
  "ls",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "zsh",
  "bash",
  "sh",
  "fish",
  "source",
  "eval",
  // File operations
  "touch",
  "mkdir",
  "rm",
  "rmdir",
  "cp",
  "mv",
  "ln",
  "chmod",
  "chown",
  "chgrp",
  // Programming runtimes
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "php",
  "java",
  "javac",
  "lua",
  "deno",
  "bun",
  // Build tools
  "make",
  "cmake",
  "ninja",
  // Utilities
  "echo",
  "printf",
  "pwd",
  "which",
  "whereis",
  "whoami",
  "env",
  "export",
  "set",
  "unset",
  "grep",
  "rg",
  "find",
  "sed",
  "awk",
  "sort",
  "uniq",
  "wc",
  "diff",
  "patch",
  "curl",
  "wget",
  "tar",
  "zip",
  "unzip",
  "gzip",
  "gunzip",
  // Process management
  "kill",
  "killall",
  "ps",
  "top",
  "htop",
])

/**
 * Safe commands that don't require approval (read-only operations).
 * These are auto-approved without user confirmation.
 */
const SAFE_COMMANDS = new Set([
  // Read-only git commands
  "git status",
  "git diff",
  "git log",
  "git show",
  "git branch",
  "git remote",
])

/**
 * Check if all command prefixes are safe (read-only operations that don't require approval).
 */
export function areCommandsSafe(prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return false
  return prefixes.every((p) => SAFE_COMMANDS.has(p))
}

/**
 * Extract command prefix from a single command (not chained).
 * Uses first word for simple commands, first two words for commands with subcommands.
 */
function extractSinglePrefix(cmd: string): string | undefined {
  const trimmed = cmd.trimStart()
  if (!trimmed) return undefined

  const parts = trimmed.split(/\s+/)
  const firstWord = parts[0]
  if (!firstWord) return undefined

  // Single-word commands: just use the command name
  if (SINGLE_WORD_COMMANDS.has(firstWord)) {
    return firstWord
  }

  // Multi-word commands (git, npm, etc.): use first two words
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1]}`
  }

  return firstWord
}

/**
 * Extract command prefixes from a Bash command for prefix-based approval.
 * Handles chained commands (&&, ||, ;, |) by extracting a prefix from each part.
 * Returns an array of prefixes - all must be approved for auto-approval.
 */
export function getCommandPrefixes(input: Record<string, unknown>): string[] | undefined {
  const cmd = input.command
  if (typeof cmd !== "string") return undefined

  // Split on command chain operators: &&, ||, ;, |
  // Note: This is a simplified split that doesn't handle quoted strings perfectly,
  // but it's good enough for the approval use case
  const parts = cmd.split(/\s*(?:&&|\|\||[;|])\s*/)

  const prefixes: string[] = []
  for (const part of parts) {
    const prefix = extractSinglePrefix(part)
    if (prefix) {
      prefixes.push(prefix)
    }
  }

  return prefixes.length > 0 ? prefixes : undefined
}

/**
 * @deprecated Use getCommandPrefixes() instead. Kept for backwards compatibility.
 */
export function getCommandPrefix(input: Record<string, unknown>): string | undefined {
  const prefixes = getCommandPrefixes(input)
  return prefixes?.[0]
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
