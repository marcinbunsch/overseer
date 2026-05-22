import { describe, it, expect } from "vitest"
import { isDefaultBranch } from "../git"

describe("isDefaultBranch", () => {
  describe("without mainBranch override", () => {
    it("returns true for main", () => {
      expect(isDefaultBranch("main", undefined)).toBe(true)
    })

    it("returns true for master", () => {
      expect(isDefaultBranch("master", undefined)).toBe(true)
    })

    it("returns false for feature branches", () => {
      expect(isDefaultBranch("feature/foo", undefined)).toBe(false)
      expect(isDefaultBranch("fix/bar", undefined)).toBe(false)
      expect(isDefaultBranch("dev", undefined)).toBe(false)
    })

    it("returns false for branches containing main/master", () => {
      expect(isDefaultBranch("main-feature", undefined)).toBe(false)
      expect(isDefaultBranch("feature-main", undefined)).toBe(false)
      expect(isDefaultBranch("master-backup", undefined)).toBe(false)
    })

    it("treats empty string override as no override", () => {
      expect(isDefaultBranch("main", "")).toBe(true)
      expect(isDefaultBranch("master", "")).toBe(true)
    })
  })

  describe("with mainBranch override", () => {
    it("returns true when branch matches override", () => {
      expect(isDefaultBranch("develop", "develop")).toBe(true)
    })

    it("returns false when branch does not match override (even for main/master)", () => {
      expect(isDefaultBranch("main", "develop")).toBe(false)
      expect(isDefaultBranch("master", "develop")).toBe(false)
    })

    it("returns false for feature branches when override is set", () => {
      expect(isDefaultBranch("feature/foo", "develop")).toBe(false)
    })
  })
})
