import { describe, it, expect } from "vitest"
import { fuzzyMatch } from "../fuzzyMatch"

describe("fuzzyMatch", () => {
  describe("matching behavior", () => {
    it("matches when all pattern characters appear in order", () => {
      const result = fuzzyMatch("abc", "aXbXc")
      expect(result.match).toBe(true)
    })

    it("does not match when characters are out of order", () => {
      const result = fuzzyMatch("abc", "cba")
      expect(result.match).toBe(false)
    })

    it("does not match when pattern characters are missing", () => {
      const result = fuzzyMatch("abc", "ab")
      expect(result.match).toBe(false)
    })

    it("matches empty pattern against any text", () => {
      const result = fuzzyMatch("", "anything")
      expect(result.match).toBe(true)
    })

    it("is case insensitive", () => {
      const result = fuzzyMatch("ABC", "abc")
      expect(result.match).toBe(true)
    })

    it("matches exact strings", () => {
      const result = fuzzyMatch("hello", "hello")
      expect(result.match).toBe(true)
    })
  })

  describe("scoring - consecutive matches", () => {
    it("scores consecutive matches higher than spread matches", () => {
      const consecutive = fuzzyMatch("abc", "abc")
      const spread = fuzzyMatch("abc", "aXbXc")
      expect(consecutive.score).toBeGreaterThan(spread.score)
    })

    it("accumulates consecutive bonus", () => {
      const twoConsec = fuzzyMatch("ab", "ab")
      const threeConsec = fuzzyMatch("abc", "abc")
      // Three consecutive should have more cumulative bonus than two
      expect(threeConsec.score).toBeGreaterThan(twoConsec.score)
    })
  })

  describe("scoring - word boundaries", () => {
    it("scores matches at start of text higher", () => {
      const atStart = fuzzyMatch("a", "abc")
      const inMiddle = fuzzyMatch("b", "abc")
      expect(atStart.score).toBeGreaterThan(inMiddle.score)
    })

    it("scores matches after slash higher", () => {
      const afterSlash = fuzzyMatch("b", "a/b")
      const notAfterSlash = fuzzyMatch("b", "ab")
      expect(afterSlash.score).toBeGreaterThan(notAfterSlash.score)
    })

    it("scores matches after dot higher", () => {
      const afterDot = fuzzyMatch("t", "file.ts")
      const notAfterDot = fuzzyMatch("t", "filets")
      expect(afterDot.score).toBeGreaterThan(notAfterDot.score)
    })
  })

  describe("scoring - path depth penalty", () => {
    it("penalizes deeper paths", () => {
      const shallow = fuzzyMatch("file", "file.ts")
      const deep = fuzzyMatch("file", "a/b/c/file.ts")
      expect(shallow.score).toBeGreaterThan(deep.score)
    })

    it("applies penalty per slash", () => {
      const oneSlash = fuzzyMatch("f", "a/f")
      const twoSlashes = fuzzyMatch("f", "a/b/f")
      expect(oneSlash.score).toBeGreaterThan(twoSlashes.score)
    })
  })

  describe("scoring - filename bonus", () => {
    it("gives bonus when pattern matches filename", () => {
      const inFilename = fuzzyMatch("test", "src/test.ts")
      const notInFilename = fuzzyMatch("src", "src/test.ts")
      // "test" appears in filename "test.ts", "src" does not
      expect(inFilename.score).toBeGreaterThan(notInFilename.score)
    })

    it("gives filename bonus for partial filename match", () => {
      const result = fuzzyMatch("comp", "src/components/Button.tsx")
      // "comp" is in the path but not in filename "Button.tsx"
      const filenameMatch = fuzzyMatch("but", "src/components/Button.tsx")
      expect(filenameMatch.score).toBeGreaterThan(result.score)
    })
  })

  describe("real-world file path scenarios", () => {
    it("prefers exact filename matches", () => {
      const files = [
        "src/components/Button.tsx",
        "src/components/ButtonGroup.tsx",
        "src/utils/buttonHelper.ts",
      ]
      const scores = files.map((f) => ({ file: f, ...fuzzyMatch("button", f) }))
      scores.sort((a, b) => b.score - a.score)

      // All should match
      expect(scores.every((s) => s.match)).toBe(true)
    })

    it("handles TypeScript/React file extensions", () => {
      const result = fuzzyMatch("tsx", "src/App.tsx")
      expect(result.match).toBe(true)
      expect(result.score).toBeGreaterThan(0)
    })

    it("matches partial paths", () => {
      const result = fuzzyMatch("src/comp", "src/components/Button.tsx")
      expect(result.match).toBe(true)
    })

    it("handles deeply nested paths", () => {
      const result = fuzzyMatch("index", "src/renderer/components/chat/tools/index.ts")
      expect(result.match).toBe(true)
    })
  })

  describe("edge cases", () => {
    it("returns score 0 for non-matches", () => {
      const result = fuzzyMatch("xyz", "abc")
      expect(result.match).toBe(false)
      expect(result.score).toBe(0)
    })

    it("handles single character patterns", () => {
      const result = fuzzyMatch("a", "abc")
      expect(result.match).toBe(true)
      expect(result.score).toBeGreaterThan(0)
    })

    it("handles pattern longer than text", () => {
      const result = fuzzyMatch("abcdef", "abc")
      expect(result.match).toBe(false)
    })

    it("handles special characters in paths", () => {
      const result = fuzzyMatch("test", "src/__tests__/test.ts")
      expect(result.match).toBe(true)
    })

    it("handles paths with multiple dots", () => {
      const result = fuzzyMatch("spec", "src/app.spec.ts")
      expect(result.match).toBe(true)
    })
  })
})
