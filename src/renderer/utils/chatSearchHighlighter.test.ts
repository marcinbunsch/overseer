/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import { findTextRanges } from "./chatSearchHighlighter"

function container(html: string): HTMLElement {
  const el = document.createElement("div")
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

describe("findTextRanges", () => {
  it("finds every occurrence and returns the matched text", () => {
    const el = container("<p>hello world, hello again</p>")
    const ranges = findTextRanges(el, "hello")
    expect(ranges).toHaveLength(2)
    expect(ranges.map((r) => r.toString())).toEqual(["hello", "hello"])
  })

  it("is case-insensitive but reports the original casing", () => {
    const el = container("<p>Overseer oversees the OVERSEER</p>")
    const ranges = findTextRanges(el, "overseer")
    expect(ranges.map((r) => r.toString())).toEqual(["Overseer", "OVERSEER"])
  })

  it("returns matches in reading order across separate elements", () => {
    const el = container("<p>find one</p><pre>find two</pre><span>find three</span>")
    const ranges = findTextRanges(el, "find")
    expect(ranges).toHaveLength(3)
    // Reading order: paragraph, then pre, then span.
    expect(ranges[0].startContainer.textContent).toBe("find one")
    expect(ranges[1].startContainer.textContent).toBe("find two")
    expect(ranges[2].startContainer.textContent).toBe("find three")
  })

  it("counts adjacent, non-overlapping matches", () => {
    const el = container("<p>aaaa</p>")
    // "aa" advances past each match, so "aaaa" yields two, not three.
    expect(findTextRanges(el, "aa")).toHaveLength(2)
  })

  it("returns nothing for an empty or whitespace-only query", () => {
    const el = container("<p>some content</p>")
    expect(findTextRanges(el, "")).toHaveLength(0)
    expect(findTextRanges(el, "   ").length).toBe(0)
  })

  it("ignores script and style text", () => {
    const el = container("<style>hint {}</style><p>a real hint</p><script>hint()</script>")
    const ranges = findTextRanges(el, "hint")
    expect(ranges).toHaveLength(1)
    expect(ranges[0].startContainer.textContent).toBe("a real hint")
  })
})
