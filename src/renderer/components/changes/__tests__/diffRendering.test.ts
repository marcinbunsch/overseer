import { describe, it, expect } from "vitest"
import { getLanguage, formatDiffComment } from "../diffRendering"
import type { DiffLine } from "../diffRendering"

describe("getLanguage", () => {
  it("returns language for known extensions", () => {
    expect(getLanguage("src/app.ts")).toBe("typescript")
    expect(getLanguage("src/app.tsx")).toBe("tsx")
    expect(getLanguage("main.js")).toBe("javascript")
    expect(getLanguage("component.jsx")).toBe("jsx")
    expect(getLanguage("lib.rs")).toBe("rust")
    expect(getLanguage("script.py")).toBe("python")
    expect(getLanguage("style.css")).toBe("css")
    expect(getLanguage("config.json")).toBe("json")
    expect(getLanguage("config.yaml")).toBe("yaml")
    expect(getLanguage("config.yml")).toBe("yaml")
    expect(getLanguage("run.sh")).toBe("bash")
    expect(getLanguage("main.go")).toBe("go")
  })

  it("handles Dockerfile", () => {
    expect(getLanguage("Dockerfile")).toBe("docker")
    expect(getLanguage("path/to/Dockerfile")).toBe("docker")
  })

  it("returns undefined for unknown extensions", () => {
    expect(getLanguage("file.xyz")).toBeUndefined()
    expect(getLanguage("README")).toBeUndefined()
  })

  it("is case-insensitive for file names", () => {
    expect(getLanguage("App.TS")).toBe("typescript")
    expect(getLanguage("STYLE.CSS")).toBe("css")
  })

  it("handles deeply nested paths", () => {
    expect(getLanguage("/Users/me/project/src/components/Button.tsx")).toBe("tsx")
  })
})

describe("formatDiffComment", () => {
  it("formats a single-line comment", () => {
    const lines: DiffLine[] = [{ type: "add", content: "const x = 1", oldNum: null, newNum: 5 }]
    const result = formatDiffComment("src/app.ts", lines, "Why is this hardcoded?")
    expect(result).toBe(
      "Comment on src/app.ts (line 5):\n```\n+const x = 1\n```\n\nWhy is this hardcoded?"
    )
  })

  it("formats a multi-line range comment", () => {
    const lines: DiffLine[] = [
      { type: "add", content: "const x = 1", oldNum: null, newNum: 10 },
      { type: "add", content: "const y = 2", oldNum: null, newNum: 11 },
      { type: "context", content: "return x + y", oldNum: 8, newNum: 12 },
    ]
    const result = formatDiffComment("src/math.ts", lines, "Check this logic")
    expect(result).toBe(
      "Comment on src/math.ts (lines 10-12):\n```\n+const x = 1\n+const y = 2\n return x + y\n```\n\nCheck this logic"
    )
  })

  it("uses oldNum for deletion lines", () => {
    const lines: DiffLine[] = [
      { type: "del", content: "old code", oldNum: 3, newNum: null },
      { type: "del", content: "more old", oldNum: 4, newNum: null },
    ]
    const result = formatDiffComment("src/file.ts", lines, "Why was this removed?")
    expect(result).toContain("lines 3-4")
    expect(result).toContain("-old code\n-more old")
  })

  it("handles mixed add/del/context lines", () => {
    const lines: DiffLine[] = [
      { type: "del", content: "removed", oldNum: 5, newNum: null },
      { type: "add", content: "added", oldNum: null, newNum: 5 },
      { type: "context", content: "unchanged", oldNum: 6, newNum: 6 },
    ]
    const result = formatDiffComment("file.ts", lines, "Comment")
    expect(result).toContain("lines 5-6")
    expect(result).toContain("-removed\n+added\n unchanged")
  })
})
