import type { Message, MessageTurn } from "../types"

export type { MessageTurn } from "../types"

function isToolCall(content: string): boolean {
  return content.startsWith("[") && content !== "[cancelled]"
}

/**
 * Groups a flat message array into turns.
 * Each user message starts a new turn. Assistant messages are split into
 * work messages (intermediate tool calls / text) and a final result message.
 */
export function groupMessagesIntoTurns(messages: Message[], isSending: boolean): MessageTurn[] {
  const turns: MessageTurn[] = []
  let currentTurn: MessageTurn | null = null

  for (const msg of messages) {
    if (msg.role === "user") {
      // Finalize the previous turn before starting a new one
      if (currentTurn) {
        finalizeTurn(currentTurn)
        turns.push(currentTurn)
      }
      currentTurn = {
        userMessage: msg,
        workMessages: [],
        resultMessage: null,
        inProgress: false,
      }
    } else {
      // Assistant message
      if (!currentTurn) {
        // Orphan assistant message with no preceding user message — create a
        // synthetic turn with an empty user message placeholder
        currentTurn = {
          userMessage: msg,
          workMessages: [],
          resultMessage: null,
          inProgress: false,
        }
        continue
      }
      currentTurn.workMessages.push(msg)
    }
  }

  // Handle the last turn
  if (currentTurn) {
    if (isSending) {
      // Last turn is still in progress — don't finalize
      currentTurn.inProgress = true
    } else {
      finalizeTurn(currentTurn)
    }
    turns.push(currentTurn)
  }

  return turns
}

/**
 * Extract the last non-tool-call text message as the result message.
 */
function finalizeTurn(turn: MessageTurn): void {
  // Walk backwards to find the last non-tool-call assistant message
  for (let i = turn.workMessages.length - 1; i >= 0; i--) {
    const msg = turn.workMessages[i]
    if (!isToolCall(msg.content)) {
      turn.resultMessage = msg
      turn.workMessages.splice(i, 1)
      break
    }
  }
}
