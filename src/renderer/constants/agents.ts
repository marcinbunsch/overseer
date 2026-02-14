import type { AgentType } from "../types"

/**
 * Display titles for each agent type
 */
export const AGENT_TITLES: Record<AgentType, string> = {
  claude: "Claude",
  codex: "Codex",
  copilot: "Copilot",
  gemini: "Gemini",
  opencode: "OpenCode",
}
