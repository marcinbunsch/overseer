import { invoke } from "@tauri-apps/api/core"

/**
 * Overseer Actions Protocol
 *
 * Agents can trigger actions in Overseer by outputting fenced code blocks:
 *
 * ```overseer
 * {"action": "open_pr", "params": {"title": "...", "body": "..."}}
 * ```
 *
 * This module provides TypeScript bindings to the Rust implementation.
 */

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

export type OverseerAction =
  | { action: "open_pr"; params: OpenPrParams }
  | { action: "merge_branch"; params: MergeBranchParams }
  | { action: "rename_chat"; params: RenameChatParams }

export interface ExtractOverseerBlocksResult {
  cleanContent: string
  actions: OverseerAction[]
}

/**
 * Extract overseer action blocks from content using the Rust backend.
 *
 * Returns the cleaned content (with blocks removed) and the list of parsed actions.
 */
export async function extractOverseerBlocks(content: string): Promise<ExtractOverseerBlocksResult> {
  return invoke<ExtractOverseerBlocksResult>("extract_overseer_blocks_cmd", { content })
}

/**
 * Check if content contains any overseer action blocks.
 *
 * This is a quick check that doesn't parse the blocks.
 */
export function hasOverseerBlocks(content: string): boolean {
  return /```overseer\s*\n[\s\S]*?\n```/.test(content)
}
