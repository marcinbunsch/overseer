/**
 * Overseer Actions Protocol
 *
 * Agents can trigger actions in Overseer by outputting fenced code blocks:
 *
 * ```overseer
 * {"action": "open_pr", "params": {"title": "...", "body": "..."}}
 * ```
 *
 * This module parses and extracts these blocks from agent output.
 */

export type OverseerActionType = "open_pr" | "merge_branch" | "rename_chat"

export interface OpenPrParams {
  title: string
  body?: string
}

export interface MergeBranchParams {
  into: string
}

export interface RenameChatParams {
  title: string
}

export type OverseerActionParams = OpenPrParams | MergeBranchParams | RenameChatParams

export interface OverseerAction {
  action: OverseerActionType
  params: OverseerActionParams
}

export interface ParsedOverseerBlock {
  /** The parsed action */
  action: OverseerAction
  /** Start index of the block in the original content */
  startIndex: number
  /** End index of the block in the original content */
  endIndex: number
  /** The raw block text including fences */
  rawBlock: string
}

/**
 * Regex to match ```overseer ... ``` blocks
 * Captures the JSON content inside
 * The newline before closing backticks is optional (Codex sometimes omits it)
 */
const OVERSEER_BLOCK_REGEX = /```overseer\s*\n([\s\S]*?)\n?```/g

/**
 * Parse all overseer action blocks from content
 */
export function parseOverseerBlocks(content: string): ParsedOverseerBlock[] {
  const blocks: ParsedOverseerBlock[] = []
  let match: RegExpExecArray | null

  // Reset regex state
  OVERSEER_BLOCK_REGEX.lastIndex = 0

  while ((match = OVERSEER_BLOCK_REGEX.exec(content)) !== null) {
    const rawBlock = match[0]
    const jsonContent = match[1].trim()
    const startIndex = match.index
    const endIndex = startIndex + rawBlock.length

    try {
      const parsed = JSON.parse(jsonContent) as { action?: string; params?: unknown }

      if (isValidAction(parsed)) {
        blocks.push({
          action: parsed as OverseerAction,
          startIndex,
          endIndex,
          rawBlock,
        })
      }
    } catch {
      // Invalid JSON, skip this block
      continue
    }
  }

  return blocks
}

/**
 * Check if content contains any overseer action blocks
 */
export function hasOverseerBlocks(content: string): boolean {
  OVERSEER_BLOCK_REGEX.lastIndex = 0
  return OVERSEER_BLOCK_REGEX.test(content)
}

/**
 * Extract overseer blocks and return content with blocks removed
 */
export function extractOverseerBlocks(content: string): {
  cleanContent: string
  actions: OverseerAction[]
} {
  const blocks = parseOverseerBlocks(content)
  const actions = blocks.map((b) => b.action)

  // Remove blocks from content (in reverse order to preserve indices)
  let cleanContent = content
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    cleanContent = cleanContent.slice(0, block.startIndex) + cleanContent.slice(block.endIndex)
  }

  // Clean up extra whitespace from removed blocks
  cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim()

  return { cleanContent, actions }
}

/**
 * Type guard to validate action structure
 */
function isValidAction(obj: unknown): obj is OverseerAction {
  if (typeof obj !== "object" || obj === null) return false

  const { action, params } = obj as { action?: unknown; params?: unknown }

  if (typeof action !== "string") return false
  if (typeof params !== "object" || params === null) return false

  switch (action) {
    case "open_pr":
      return typeof (params as OpenPrParams).title === "string"
    case "merge_branch":
      return typeof (params as MergeBranchParams).into === "string"
    case "rename_chat":
      return typeof (params as RenameChatParams).title === "string"
    default:
      return false
  }
}
