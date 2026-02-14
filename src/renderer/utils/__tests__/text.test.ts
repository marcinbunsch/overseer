import { describe, it, expect } from "vitest"
import { countLines } from "../text"

describe("countLines", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0)
  })

  it("returns 1 for single line without newline", () => {
    expect(countLines("hello")).toBe(1)
  })

  it("returns 2 for two lines", () => {
    expect(countLines("hello\nworld")).toBe(2)
  })

  it("counts trailing newline as additional line", () => {
    expect(countLines("hello\n")).toBe(2)
  })

  it("handles multiple lines", () => {
    expect(countLines("a\nb\nc\nd\ne")).toBe(5)
  })
})
