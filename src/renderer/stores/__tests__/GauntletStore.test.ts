import { describe, expect, it, beforeEach } from "vitest"
import { gauntletStore } from "../GauntletStore"

function clear() {
  gauntletStore.reviewers.forEach((r) => gauntletStore.removeReviewer(r.id))
}

describe("GauntletStore", () => {
  beforeEach(() => {
    clear()
  })

  it("seeds default reviewers when config is empty", () => {
    gauntletStore.initFromConfig(undefined)
    const names = gauntletStore.reviewers.map((r) => r.name)
    expect(names).toContain("Code Review")
    expect(names).toContain("Code Quality Assurance")
    expect(names).toContain("Security Review")
  })

  it("honors an explicit empty array without re-seeding defaults", () => {
    gauntletStore.initFromConfig([])
    expect(gauntletStore.reviewers).toHaveLength(0)
  })

  it("uses stored reviewers when provided instead of defaults", () => {
    gauntletStore.initFromConfig([
      {
        id: "abc",
        name: "Only One",
        prompt: "look at it",
        agentType: "claude",
        modelVersion: null,
        enabled: true,
      },
    ])
    expect(gauntletStore.reviewers).toHaveLength(1)
    expect(gauntletStore.reviewers[0].name).toBe("Only One")
  })

  it("adds, updates and removes reviewers", () => {
    const reviewer = gauntletStore.addReviewer({
      name: "Perf",
      prompt: "speed",
      agentType: "codex",
      modelVersion: "gpt-x",
      enabled: true,
    })
    expect(gauntletStore.getReviewer(reviewer.id)?.name).toBe("Perf")

    gauntletStore.updateReviewer(reviewer.id, { name: "Performance", enabled: false })
    expect(gauntletStore.getReviewer(reviewer.id)?.name).toBe("Performance")
    expect(gauntletStore.getReviewer(reviewer.id)?.enabled).toBe(false)

    gauntletStore.removeReviewer(reviewer.id)
    expect(gauntletStore.getReviewer(reviewer.id)).toBeUndefined()
  })

  it("exposes only enabled reviewers via enabledReviewers", () => {
    gauntletStore.addReviewer({
      name: "On",
      prompt: "",
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    })
    gauntletStore.addReviewer({
      name: "Off",
      prompt: "",
      agentType: "claude",
      modelVersion: null,
      enabled: false,
    })
    expect(gauntletStore.enabledReviewers.map((r) => r.name)).toEqual(["On"])
  })

  it("round-trips through getConfigs", () => {
    gauntletStore.addReviewer({
      name: "RT",
      prompt: "p",
      agentType: "gemini",
      modelVersion: null,
      enabled: true,
    })
    const configs = gauntletStore.getConfigs()
    clear()
    expect(gauntletStore.reviewers).toHaveLength(0)
    gauntletStore.initFromConfig(configs)
    expect(gauntletStore.reviewers.map((r) => r.name)).toEqual(["RT"])
  })
})
