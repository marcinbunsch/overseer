import { describe, it, expect } from "vitest"
import { isDefaultBranch } from "../git"

describe("isDefaultBranch", () => {
  it("returns true for main", () => {
    expect(isDefaultBranch("main")).toBe(true)
  })

  it("returns true for master", () => {
    expect(isDefaultBranch("master")).toBe(true)
  })

  it("returns false for feature branches", () => {
    expect(isDefaultBranch("feature/foo")).toBe(false)
    expect(isDefaultBranch("fix/bar")).toBe(false)
    expect(isDefaultBranch("dev")).toBe(false)
  })

  it("returns false for branches containing main/master", () => {
    expect(isDefaultBranch("main-feature")).toBe(false)
    expect(isDefaultBranch("feature-main")).toBe(false)
    expect(isDefaultBranch("master-backup")).toBe(false)
  })
})
