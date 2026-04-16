import type { Backend } from "../backend/types"
import type { AgentType } from "./types"
import type { AgentService } from "./types"
import { ClaudeAgentService, claudeAgentService } from "./claude"
import { codexAgentService } from "./codex"
import { copilotAgentService } from "./copilot"
import { geminiAgentService } from "./gemini"
import { opencodeAgentService } from "./opencode"
import { piAgentService } from "./pi"

/** Singleton instances (use default Tauri backend) */
const services: Record<AgentType, AgentService> = {
  claude: claudeAgentService,
  codex: codexAgentService,
  copilot: copilotAgentService,
  gemini: geminiAgentService,
  opencode: opencodeAgentService,
  pi: piAgentService,
}

/**
 * Get the singleton agent service instance.
 * Use this for operations that don't need a specific backend (e.g., checking if running).
 */
export function getAgentService(agentType: AgentType): AgentService {
  return services[agentType]
}

/**
 * Create a new agent service instance with a specific backend.
 * Use this for per-chat services that need to use the workspace's backend.
 */
export function createAgentService(agentType: AgentType, backend: Backend): AgentService {
  switch (agentType) {
    case "claude":
      return new ClaudeAgentService(backend)
    // TODO: Update other services to support per-instance backends
    // For now, fall back to singletons (only works with local backend)
    case "codex":
      return codexAgentService
    case "copilot":
      return copilotAgentService
    case "gemini":
      return geminiAgentService
    case "opencode":
      return opencodeAgentService
    case "pi":
      return piAgentService
  }
}
