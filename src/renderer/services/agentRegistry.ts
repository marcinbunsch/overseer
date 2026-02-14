import type { AgentType } from "./types"
import type { AgentService } from "./types"
import { claudeAgentService } from "./claude"
import { codexAgentService } from "./codex"
import { copilotAgentService } from "./copilot"
import { geminiAgentService } from "./gemini"
import { opencodeAgentService } from "./opencode"

const services: Record<AgentType, AgentService> = {
  claude: claudeAgentService,
  codex: codexAgentService,
  copilot: copilotAgentService,
  gemini: geminiAgentService,
  opencode: opencodeAgentService,
}

export function getAgentService(agentType: AgentType): AgentService {
  return services[agentType]
}
