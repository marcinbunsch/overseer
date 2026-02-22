/**
 * Export chat to Markdown format.
 *
 * This is a Tauri-only feature because it relies on:
 * - @tauri-apps/plugin-dialog for native file picker
 * - @tauri-apps/plugin-fs for writing files
 *
 * These are Tauri-specific APIs not available in overseer-core's
 * framework-agnostic design.
 */

import type { Chat, Message } from "../types"
import { getAgentDisplayName } from "./agentDisplayName"
import { parseToolCall } from "../components/chat/tools/parseToolCall"

/**
 * Format a timestamp for display in the export
 */
function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Format a single message to markdown
 */
function formatMessage(message: Message): string {
  const timestamp = formatTimestamp(new Date(message.timestamp))

  // User messages
  if (message.role === "user") {
    // Skip system meta messages
    if (message.meta?.type === "system") {
      return ""
    }

    // Meta messages (like plan reviews)
    if (message.meta) {
      return `### ${message.meta.label}\n_${timestamp}_\n\n${message.content}\n`
    }

    return `## User\n_${timestamp}_\n\n${message.content}\n`
  }

  // Assistant messages
  // Skip cancelled messages
  if (message.content === "[cancelled]") {
    return `_User cancelled_\n`
  }

  // Bash output
  if (message.isBashOutput) {
    return `\`\`\`\n${message.content}\n\`\`\`\n`
  }

  // Info messages
  if (message.isInfo) {
    return `_${message.content}_\n`
  }

  // Tool calls
  const tool = parseToolCall(message.content)
  if (tool) {
    return formatToolCall(tool.toolName, tool.input, timestamp)
  }

  // Plain text
  return `## Assistant\n_${timestamp}_\n\n${message.content}\n`
}

/**
 * Format a tool call to markdown
 */
function formatToolCall(
  toolName: string,
  input: Record<string, unknown> | null,
  timestamp: string
): string {
  const lines: string[] = [`### Tool: ${toolName}`, `_${timestamp}_`, ""]

  if (!input) {
    return lines.join("\n") + "\n"
  }

  // Format based on tool type
  switch (toolName) {
    case "Bash": {
      const command = input.command as string | undefined
      const description = input.description as string | undefined
      if (description) {
        lines.push(`> ${description}`)
        lines.push("")
      }
      if (command) {
        lines.push("```bash", command, "```")
      }
      break
    }

    case "Read": {
      const filePath = input.file_path as string | undefined
      if (filePath) {
        lines.push(`Reading: \`${filePath}\``)
      }
      break
    }

    case "Write": {
      const filePath = input.file_path as string | undefined
      if (filePath) {
        lines.push(`Writing: \`${filePath}\``)
      }
      break
    }

    case "Edit": {
      const filePath = input.file_path as string | undefined
      if (filePath) {
        lines.push(`Editing: \`${filePath}\``)
      }
      break
    }

    case "Glob": {
      const pattern = input.pattern as string | undefined
      const path = input.path as string | undefined
      if (pattern) {
        lines.push(`Pattern: \`${pattern}\``)
      }
      if (path) {
        lines.push(`Path: \`${path}\``)
      }
      break
    }

    case "Grep": {
      const pattern = input.pattern as string | undefined
      const path = input.path as string | undefined
      if (pattern) {
        lines.push(`Pattern: \`${pattern}\``)
      }
      if (path) {
        lines.push(`Path: \`${path}\``)
      }
      break
    }

    case "WebFetch": {
      const url = input.url as string | undefined
      if (url) {
        lines.push(`URL: ${url}`)
      }
      break
    }

    case "WebSearch": {
      const query = input.query as string | undefined
      if (query) {
        lines.push(`Query: "${query}"`)
      }
      break
    }

    default: {
      // Generic: show JSON
      lines.push("```json", JSON.stringify(input, null, 2), "```")
    }
  }

  return lines.join("\n") + "\n"
}

/**
 * Export a chat to markdown format
 */
export function exportChatToMarkdown(chat: Chat): string {
  const lines: string[] = []

  // Header
  lines.push(`# ${chat.label}`)
  lines.push("")

  // Metadata
  const agentName = chat.agentType ? getAgentDisplayName(chat.agentType) : "Unknown"
  lines.push(`**Agent**: ${agentName}`)
  if (chat.modelVersion) {
    lines.push(`**Model**: ${chat.modelVersion}`)
  }
  lines.push(`**Created**: ${formatTimestamp(new Date(chat.createdAt))}`)
  lines.push(`**Updated**: ${formatTimestamp(new Date(chat.updatedAt))}`)
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
