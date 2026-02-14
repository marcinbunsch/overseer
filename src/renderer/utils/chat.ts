import type { Message } from "../types"

/**
 * Summarize the work done in a turn by counting tool calls and text messages
 */
export function summarizeTurnWork(workMessages: Message[]): string {
  let toolCalls = 0
  let textMessages = 0
  for (const msg of workMessages) {
    if (msg.content.startsWith("[")) {
      toolCalls++
    } else {
      textMessages++
    }
  }
  const parts: string[] = []
  if (toolCalls > 0) {
    parts.push(`${toolCalls} tool call${toolCalls !== 1 ? "s" : ""}`)
  }
  if (textMessages > 0) {
    parts.push(`${textMessages} message${textMessages !== 1 ? "s" : ""}`)
  }
  return parts.join(", ")
}
