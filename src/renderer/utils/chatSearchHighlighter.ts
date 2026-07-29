/**
 * In-session search engine. Walks the rendered DOM of the message-list container to find
 * every occurrence of a query and paints it with the CSS Custom Highlight API — which draws
 * over existing text ranges WITHOUT inserting nodes into the React-owned DOM, so highlights
 * survive streaming re-renders. Falls back to the native selection when the API is missing.
 */

const HIGHLIGHT_ALL = "chat-search"
const HIGHLIGHT_CURRENT = "chat-search-current"

// The Highlight API shipped in WebKit 17.2 / Chrome 105. Older Linux WebKitGTK may lack it,
// so feature-detect and degrade to selection-based navigation (still zero DOM mutation).
const supportsHighlightAPI =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

export interface SearchState {
  matchCount: number
  /** 0-based index of the active match, or -1 when there are none. */
  currentIndex: number
}

/**
 * Find every occurrence of `query` in the text nodes under `container`, in reading order.
 * Pure (no side effects) so it can be tested under jsdom. Case-insensitive. Matches that
 * straddle element boundaries are not found — a single word rarely splits across elements.
 */
export function findTextRanges(container: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return []

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.tagName === "SCRIPT" || parent.tagName === "STYLE") {
        return NodeFilter.FILTER_REJECT
      }
      const text = node.textContent
      return text && text.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const ranges: Range[] = []
  let node = walker.nextNode()
  while (node) {
    const haystack = (node.textContent ?? "").toLowerCase()
    let from = 0
    for (;;) {
      const idx = haystack.indexOf(needle, from)
      if (idx === -1) break
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, idx + needle.length)
      ranges.push(range)
      from = idx + needle.length
    }
    node = walker.nextNode()
  }
  return ranges
}

export class SearchHighlighter {
  private container: HTMLElement | null = null
  private ranges: Range[] = []
  private currentIndex = -1

  setContainer(container: HTMLElement | null): void {
    this.container = container
  }

  /** Re-run the query against the current DOM and jump to the first match. */
  search(query: string): SearchState {
    this.dropHighlights()
    this.ranges =
      this.container && query.trim().length > 0 ? findTextRanges(this.container, query) : []
    this.currentIndex = this.ranges.length > 0 ? 0 : -1
    this.apply()
    this.scrollToCurrent()
    return this.state()
  }

  /** Move to `index`, wrapping around both ends. */
  goTo(index: number): SearchState {
    const count = this.ranges.length
    if (count === 0) {
      this.currentIndex = -1
    } else {
      this.currentIndex = ((index % count) + count) % count
    }
    this.apply()
    this.scrollToCurrent()
    return this.state()
  }

  next(): SearchState {
    return this.goTo(this.currentIndex + 1)
  }

  prev(): SearchState {
    return this.goTo(this.currentIndex - 1)
  }

  clear(): void {
    this.ranges = []
    this.currentIndex = -1
    this.dropHighlights()
  }

  dispose(): void {
    this.clear()
    this.container = null
  }

  private state(): SearchState {
    return { matchCount: this.ranges.length, currentIndex: this.currentIndex }
  }

  private apply(): void {
    if (!supportsHighlightAPI) return
    // No matches: delete the registrations rather than setting empty highlights — an empty
    // highlight left registered keeps the previous paint on screen in WebKit.
    if (this.ranges.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_ALL)
      CSS.highlights.delete(HIGHLIGHT_CURRENT)
      return
    }
    const all = new Highlight()
    for (const range of this.ranges) all.add(range)
    CSS.highlights.set(HIGHLIGHT_ALL, all)

    const current = this.ranges[this.currentIndex]
    if (current) {
      const currentHighlight = new Highlight(current)
      // Higher priority so the active match paints over the all-matches wash.
      currentHighlight.priority = 1
      CSS.highlights.set(HIGHLIGHT_CURRENT, currentHighlight)
    } else {
      CSS.highlights.delete(HIGHLIGHT_CURRENT)
    }
  }

  private dropHighlights(): void {
    if (supportsHighlightAPI) {
      CSS.highlights.delete(HIGHLIGHT_ALL)
      CSS.highlights.delete(HIGHLIGHT_CURRENT)
    } else {
      window.getSelection()?.removeAllRanges()
    }
  }

  private scrollToCurrent(): void {
    const range = this.ranges[this.currentIndex]
    // A streaming re-render can unmount the node behind a stale range; skip rather than throw.
    if (!range || !range.startContainer.isConnected) return

    if (!supportsHighlightAPI) {
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }

    range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" })
  }
}
