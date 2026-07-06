import { backend as defaultBackend } from "../backend"
import type { Backend } from "../backend/types"

/** A Claude skill discovered from a `.claude/skills/<name>/SKILL.md` file. */
export interface Skill {
  /** Invocation name (frontmatter `name`, falling back to the directory name). */
  name: string
  /** One-line summary from frontmatter `description`. */
  description: string
  /** Where the skill was found. */
  source: "project" | "user"
}

/**
 * SkillsService discovers the Claude skills available to an agent running in a
 * given workspace. Skills are a Claude-only feature; callers should gate usage
 * on the active agent being "claude".
 */
export class SkillsService {
  private backend: Backend

  constructor(backend: Backend = defaultBackend) {
    this.backend = backend
  }

  /** List skills for a workspace, sorted by name (project shadows user). */
  async listSkills(workspacePath: string): Promise<Skill[]> {
    return this.backend.invoke<Skill[]>("list_skills", { workspacePath })
  }
}

export const skillsService = new SkillsService()
