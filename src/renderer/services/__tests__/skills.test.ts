import { describe, it, expect, vi, beforeEach } from "vitest"
import { skillsService } from "../skills"
import { backend } from "../../backend"

// Mock the backend so we can assert what the service invokes.
vi.mock("../../backend", () => ({
  backend: {
    invoke: vi.fn(),
  },
}))

describe("SkillsService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(backend.invoke).mockResolvedValue([])
  })

  it("passes the workspace path and the account's config dir to the backend", async () => {
    await skillsService.listSkills("/Users/dev/project", "~/.claude-work")

    expect(backend.invoke).toHaveBeenCalledWith("list_skills", {
      workspacePath: "/Users/dev/project",
      claudeConfigDir: "~/.claude-work",
    })
  })

  it("sends null config dir for the default account", async () => {
    await skillsService.listSkills("/Users/dev/project")

    expect(backend.invoke).toHaveBeenCalledWith("list_skills", {
      workspacePath: "/Users/dev/project",
      claudeConfigDir: null,
    })
  })
})
