import type { ToolMeta } from "../../../types"

export interface ToolCall {
  /** Raw label including brackets, e.g. "[Bash]" or "[Auto-approved] Bash" */
  label: string
  /** The tool name without brackets/prefixes */
  toolName: string
  /** Raw JSON body string */
  body: string
  /** Parsed JSON input (null if parse fails) */
  input: Record<string, unknown> | null
  /** Pre-computed metadata from the store (persisted) */
  toolMeta?: ToolMeta
}

export function parseToolCall(content: string): ToolCall | null {
  if (!content.startsWith("[")) return null
  const bracketEnd = content.indexOf("]")
  if (bracketEnd < 0) return null

  const label = content.slice(0, bracketEnd + 1).trim()
  const afterBracket = content.slice(bracketEnd + 1).trim()

  // Extract tool name: could be "[Bash]" or "[Auto-approved] Bash" or "[Tool approval required] Bash"
  let toolName = label.slice(1, -1) // Remove brackets
  const rest = afterBracket

  // For prefixed labels like "[Auto-approved]", the tool name follows the bracket
  if (toolName === "Auto-approved" || toolName === "Tool approval required") {
    const newlineIdx = rest.indexOf("\n")
    const firstLine = newlineIdx >= 0 ? rest.slice(0, newlineIdx) : rest
    toolName = firstLine.trim()
  }

  // Find the JSON body
  const jsonStart = content.indexOf("{", bracketEnd)
  const body = jsonStart >= 0 ? content.slice(jsonStart) : ""

  let input: Record<string, unknown> | null = null
  if (body) {
    try {
      input = JSON.parse(body)
    } catch {
      // not valid JSON
    }
  }

  return { label, toolName, body, input }
}
