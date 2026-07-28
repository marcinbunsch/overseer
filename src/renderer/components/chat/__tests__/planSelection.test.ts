/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import {
  closestSourceElement,
  sourceRangeFromBoundaries,
  lineRangeFromMarks,
  unionRect,
} from "../planSelection"

function block(tag: string, start: number, end: number, text: string): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute("data-src-start", String(start))
  el.setAttribute("data-src-end", String(end))
  el.textContent = text
  return el
}

/** A highlight mark (as web-highlighter injects) wrapping text inside a source block. */
function markInside(blockEl: HTMLElement): HTMLElement {
  const mark = document.createElement("mark")
  mark.textContent = "marked"
  blockEl.appendChild(mark)
  return mark
}

describe("closestSourceElement", () => {
  it("returns the nearest ancestor carrying source line data", () => {
    const heading = block("h1", 1, 1, "Title")
    const inner = document.createElement("em")
    inner.textContent = "Title"
    heading.appendChild(inner)

    expect(closestSourceElement(inner.firstChild)).toBe(heading)
  })

  it("returns null when no ancestor has source data", () => {
    const loose = document.createElement("div")
    loose.textContent = "no data here"
    expect(closestSourceElement(loose.firstChild)).toBeNull()
  })
})

describe("sourceRangeFromBoundaries", () => {
  it("spans from the first block's start to the last block's end", () => {
    const heading = block("h1", 1, 1, "Title")
    const list = block("ul", 5, 6, "items")
    expect(sourceRangeFromBoundaries(heading, list)).toEqual({ startLine: 1, endLine: 6 })
  })

  it("handles a selection within a single block", () => {
    const paragraph = block("p", 3, 3, "one line")
    expect(sourceRangeFromBoundaries(paragraph, paragraph)).toEqual({ startLine: 3, endLine: 3 })
  })

  it("orders boundaries regardless of which element came first", () => {
    const later = block("p", 5, 5, "later")
    const earlier = block("h1", 1, 1, "earlier")
    // End element appears before start element in the source: min/max still correct.
    expect(sourceRangeFromBoundaries(later, earlier)).toEqual({ startLine: 1, endLine: 5 })
  })

  it("returns null when line data is missing", () => {
    const good = block("p", 2, 2, "ok")
    const bad = document.createElement("p")
    bad.textContent = "no attrs"
    expect(sourceRangeFromBoundaries(good, bad)).toBeNull()
  })
})

describe("lineRangeFromMarks", () => {
  it("derives the line range from the blocks the first and last marks sit in", () => {
    const heading = block("h1", 1, 1, "Title")
    const paragraph = block("p", 3, 4, "A paragraph.")
    const firstMark = markInside(heading)
    const lastMark = markInside(paragraph)

    expect(lineRangeFromMarks([firstMark, lastMark])).toEqual({ startLine: 1, endLine: 4 })
  })

  it("handles a single mark within one block", () => {
    const paragraph = block("p", 3, 4, "A paragraph.")
    const mark = markInside(paragraph)
    expect(lineRangeFromMarks([mark])).toEqual({ startLine: 3, endLine: 4 })
  })

  it("returns null for no marks", () => {
    expect(lineRangeFromMarks([])).toBeNull()
  })

  it("returns null when a mark isn't inside a source block", () => {
    const orphan = document.createElement("mark")
    orphan.textContent = "loose"
    expect(lineRangeFromMarks([orphan])).toBeNull()
  })
})

describe("unionRect", () => {
  it("covers all the given element rects", () => {
    const a = document.createElement("mark")
    a.getBoundingClientRect = () => new DOMRect(10, 20, 100, 16)
    const b = document.createElement("mark")
    b.getBoundingClientRect = () => new DOMRect(5, 40, 200, 16)

    const rect = unionRect([a, b])
    expect(rect.left).toBe(5)
    expect(rect.top).toBe(20)
    expect(rect.right).toBe(205) // max right: 5 + 200
    expect(rect.bottom).toBe(56) // max bottom: 40 + 16
  })

  it("returns an empty rect for no elements", () => {
    const rect = unionRect([])
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
  })
})
