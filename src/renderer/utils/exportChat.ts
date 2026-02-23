/**
 * Utilities to export chat data to Markdown format.
 *
 * This module is pure formatting logic with no I/O or Tauri dependencies.
 * The Tauri-specific behavior (file picker, file writing) lives in
 * SaveChatButton.tsx which calls these helpers.
 */

import type { Chat, Message } from "../types"
import { getAgentDisplayName } from "./agentDisplayName"
import { parseToolCall } from "../components/chat/tools/parseToolCall"

/**
 * Format a single message to markdown.
 * User messages are blockquotes with "Me:" prefix, assistant messages are plain.
 */
function formatMessage(message: Message): string {
  // User messages
  if (message.role === "user") {
    // Skip system meta messages
    if (message.meta?.type === "system") {
      return ""
    }

    // Meta messages (like plan reviews) - show label
    if (message.meta) {
      return formatBlockquote(`**${message.meta.label}:** ${message.content}`)
    }

    // Regular user message - blockquote with Me: prefix
    return formatBlockquote(`**Me:** ${message.content}`)
  }

  // Assistant messages
  // Skip cancelled messages
  if (message.content === "[cancelled]") {
    return "_Cancelled_\n"
  }

  // Bash output
  if (message.isBashOutput) {
    return `\`\`\`\n${message.content}\n\`\`\`\n`
  }

  // Info messages
  if (message.isInfo) {
    return `_${message.content}_\n`
  }

  // Tool calls - compact format
  const tool = parseToolCall(message.content)
  if (tool) {
    return formatToolCall(tool.toolName, tool.input)
  }

  // Plain assistant text
  return `${message.content}\n`
}

/**
 * Format content as a markdown blockquote (handles multi-line)
 */
function formatBlockquote(content: string): string {
  return (
    content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n") + "\n"
  )
}

/**
 * Get file path from tool input (supports both file_path and path keys)
 */
function getFilePath(input: Record<string, unknown>): string | undefined {
  return (input.file_path as string | undefined) ?? (input.path as string | undefined)
}

/**
 * Format a tool call to compact markdown
 */
function formatToolCall(toolName: string, input: Record<string, unknown> | null): string {
  if (!input) {
    return `**${toolName}**\n`
  }

  // Format based on tool type - keep it compact
  switch (toolName) {
    case "Bash": {
      const command = input.command as string | undefined
      if (command) {
        return `\`\`\`bash\n${command}\n\`\`\`\n`
      }
      return `**Bash**\n`
    }

    case "Read": {
      const filePath = getFilePath(input)
      return filePath ? `📖 \`${filePath}\`\n` : `**Read**\n`
    }

    case "Write": {
      const filePath = getFilePath(input)
      return filePath ? `📝 \`${filePath}\`\n` : `**Write**\n`
    }

    case "Edit": {
      const filePath = getFilePath(input)
      return filePath ? `✏️ \`${filePath}\`\n` : `**Edit**\n`
    }

    case "Glob": {
      const pattern = input.pattern as string | undefined
      return pattern ? `🔍 \`${pattern}\`\n` : `**Glob**\n`
    }

    case "Grep": {
      const pattern = input.pattern as string | undefined
      return pattern ? `🔎 \`${pattern}\`\n` : `**Grep**\n`
    }

    case "WebFetch": {
      const url = input.url as string | undefined
      return url ? `🌐 ${url}\n` : `**WebFetch**\n`
    }

    case "WebSearch": {
      const query = input.query as string | undefined
      return query ? `🔍 "${query}"\n` : `**WebSearch**\n`
    }

    case "TodoWrite":
      return "" // Skip todo writes, they're noise

    default:
      return `**${toolName}**\n`
  }
}

/**
 * Export a chat to markdown format
 */
export function exportChatToMarkdown(chat: Chat): string {
  const lines: string[] = []

  // Minimal header
  lines.push(`# ${chat.label}`)
  const agentName = chat.agentType ? getAgentDisplayName(chat.agentType) : "Unknown"
  const model = chat.modelVersion ? ` (${chat.modelVersion})` : ""
  lines.push(`_${agentName}${model}_`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // Messages
  for (const message of chat.messages) {
    const formatted = formatMessage(message)
    if (formatted) {
      lines.push(formatted)
    }
  }

  return lines.join("\n")
}

/**
 * Generate a safe filename from the chat label
 */
export function generateFilename(chat: Chat): string {
  // Sanitize the label for use as a filename
  const sanitized = chat.label
    .replace(/[/\\?%*:|"<>]/g, "-") // Replace invalid chars
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Trim leading/trailing dashes
    .toLowerCase()
    .slice(0, 50) // Limit length

  return `${sanitized || "chat"}.md`
}
