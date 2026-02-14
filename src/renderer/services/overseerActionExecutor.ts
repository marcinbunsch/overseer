/**
 * Overseer Action Executor
 *
 * Executes actions triggered by agents via the overseer protocol.
 * Actions are dispatched via event bus to appropriate stores.
 */

import type {
  OverseerAction,
  OpenPrParams,
  MergeBranchParams,
  RenameChatParams,
} from "../utils/overseerActions"
import { toastStore } from "../stores/ToastStore"
import { eventBus } from "../utils/eventBus"

export interface OverseerActionContext {
  /** The chat ID that triggered this action */
  chatId: string
  /** Callback to rename the chat */
  renameChat: (chatId: string, newLabel: string) => void
}

export interface ActionResult {
  success: boolean
  message?: string
}

/**
 * Execute an overseer action
 */
export async function executeOverseerAction(
  action: OverseerAction,
  context: OverseerActionContext
): Promise<ActionResult> {
  switch (action.action) {
    case "open_pr":
      return executeOpenPr(action.params as OpenPrParams)
    case "merge_branch":
      return executeMergeBranch(action.params as MergeBranchParams)
    case "rename_chat":
      return executeRenameChat(action.params as RenameChatParams, context)
    default:
      return { success: false, message: `Unknown action: ${(action as OverseerAction).action}` }
  }
}

/**
 * Open PR action - emits event for ChangedFilesStore to handle
 */
async function executeOpenPr(params: OpenPrParams): Promise<ActionResult> {
  const { title, body } = params

  eventBus.emit("overseer:open_pr", { title, body })
  toastStore.show(`Creating PR: ${title}`)

  return { success: true, message: `PR creation initiated: ${title}` }
}

/**
 * Merge branch action - emits event for ChangedFilesStore to handle
 */
async function executeMergeBranch(params: MergeBranchParams): Promise<ActionResult> {
  const { into } = params

  eventBus.emit("overseer:merge_branch", { into })
  toastStore.show(`Merging into ${into}`)

  return { success: true, message: `Merge initiated into ${into}` }
}

/**
 * Rename chat action - directly renames the chat
 */
async function executeRenameChat(
  params: RenameChatParams,
  context: OverseerActionContext
): Promise<ActionResult> {
  const { title } = params

  context.renameChat(context.chatId, title)
  toastStore.show(`Chat renamed to: ${title}`)

  return { success: true, message: `Chat renamed to: ${title}` }
}
