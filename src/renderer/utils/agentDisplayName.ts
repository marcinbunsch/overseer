import type { AgentType } from "../types"

/**
 * Get the display name for an agent type.
 * Used for UI labels like tab names, placeholders, etc.
 */
export function getAgentDisplayName(agentType?: string): string {
  switch (agentType as AgentType) {
    case "codex":
      return "Codex"
    case "copilot":
      return "Copilot"
    case "gemini":
      return "Gemini"
    case "opencode":
      return "OpenCode"
    case "claude":
    default:
      return "Claude"
  }
}
