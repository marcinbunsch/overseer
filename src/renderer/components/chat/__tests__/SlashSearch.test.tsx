/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { SlashSearch } from "../SlashSearch"
import { skillsService } from "../../../services/skills"

vi.mock("../../../services/skills", () => ({
  skillsService: {
    listSkills: vi.fn(),
  },
}))

describe("SlashSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(skillsService.listSkills).mockResolvedValue([])
  })

  it("requests skills for the workspace and the passed config dir", async () => {
    render(
      <SlashSearch
        query=""
        workspacePath="/Users/dev/project"
        claudeConfigDir="~/.claude-work"
        onSelect={vi.fn()}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(skillsService.listSkills).toHaveBeenCalledWith("/Users/dev/project", "~/.claude-work")
    })
  })

  it("passes undefined config dir for the default account", async () => {
    render(
      <SlashSearch
        query=""
        workspacePath="/Users/dev/project"
        onSelect={vi.fn()}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(skillsService.listSkills).toHaveBeenCalledWith("/Users/dev/project", undefined)
    })
  })
})
