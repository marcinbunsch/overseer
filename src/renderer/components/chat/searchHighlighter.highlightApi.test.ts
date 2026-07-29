/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// jsdom lacks the CSS Custom Highlight API, so stub a minimal registry and force the module's
// feature-detect to pass. Verifies the registry is actually emptied when the query is cleared.
describe("SearchHighlighter — CSS Highlight registry", () => {
  let SearchHighlighter: typeof import("./searchHighlighter").SearchHighlighter
  let registry: Map<string, unknown>

  beforeEach(async () => {
    registry = new Map()
    class FakeHighlight {
      priority = 0
      ranges: unknown[]
      constructor(...ranges: unknown[]) {
        this.ranges = ranges
      }
      add(range: unknown) {
        this.ranges.push(range)
      }
    }
    vi.stubGlobal("Highlight", FakeHighlight)
    vi.stubGlobal("CSS", {
      highlights: {
        set: (key: string, value: unknown) => registry.set(key, value),
        delete: (key: string) => registry.delete(key),
      },
    })
    Element.prototype.scrollIntoView = vi.fn()

    vi.resetModules()
    ;({ SearchHighlighter } = await import("./searchHighlighter"))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function containerWith(html: string): HTMLElement {
    const el = document.createElement("div")
    el.innerHTML = html
    document.body.appendChild(el)
    return el
  }

  it("registers highlights for a match and removes them when the query is cleared", () => {
    const highlighter = new SearchHighlighter()
    highlighter.setContainer(containerWith("<p>a file and another file</p>"))

    highlighter.search("file")
    expect(registry.has("chat-search")).toBe(true)
    expect(registry.has("chat-search-current")).toBe(true)

    highlighter.search("")
    expect(registry.has("chat-search")).toBe(false)
    expect(registry.has("chat-search-current")).toBe(false)
  })

  it("removes highlights when a query no longer matches", () => {
    const highlighter = new SearchHighlighter()
    highlighter.setContainer(containerWith("<p>a file</p>"))

    highlighter.search("file")
    expect(registry.has("chat-search")).toBe(true)

    highlighter.search("zzz")
    expect(registry.has("chat-search")).toBe(false)
    expect(registry.has("chat-search-current")).toBe(false)
  })
})
