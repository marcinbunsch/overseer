/**
 * Helpers for locating a text-anchored plan annotation in source line terms.
 *
 * web-highlighter owns selection capture, exact-substring painting, and serialization.
 * These helpers only derive a source line range from the rendered highlight marks, so a
 * preview note can be sorted and labelled alongside the diff-view (line-anchored) notes.
 * Every block carries `data-src-start` / `data-src-end` (1-based, inclusive) from
 * `rehypeSourceLines`.
 */

/** An inclusive, 1-based source line range. */
export interface LineRange {
  startLine: number
  endLine: number
}

/**
 * Walks up from a DOM node to the nearest ancestor carrying source line data.
 * Returns null if none is found within the preview.
 */
export function closestSourceElement(node: Node | null): HTMLElement | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute("data-src-start")) {
      return current
    }
    current = current.parentNode
  }
  return null
}

/**
 * Reads the inclusive source line range spanned by two boundary elements.
 * Returns null if either element lacks parseable line data.
 */
export function sourceRangeFromBoundaries(
  startElement: HTMLElement,
  endElement: HTMLElement
): LineRange | null {
  const starts = [lineAttr(startElement, "data-src-start"), lineAttr(endElement, "data-src-start")]
  const ends = [lineAttr(startElement, "data-src-end"), lineAttr(endElement, "data-src-end")]
  if (starts.includes(null) || ends.includes(null)) return null

  return {
    startLine: Math.min(...(starts as number[])),
    endLine: Math.max(...(ends as number[])),
  }
}

/**
 * Derives the source line range a set of highlight marks covers, from the blocks that
 * contain the first and last mark. Returns null when the marks aren't inside source blocks.
 */
export function lineRangeFromMarks(marks: HTMLElement[]): LineRange | null {
  if (marks.length === 0) return null
  const startElement = closestSourceElement(marks[0])
  const endElement = closestSourceElement(marks[marks.length - 1])
  if (!startElement || !endElement) return null
  return sourceRangeFromBoundaries(startElement, endElement)
}

/**
 * The viewport rect that covers all of the given elements — the bounding box of a
 * selection's highlight marks, used to anchor the comment popover to the whole selection
 * rather than an arbitrary single mark.
 */
export function unionRect(elements: HTMLElement[]): DOMRect {
  if (elements.length === 0) return new DOMRect()
  const rects = elements.map((el) => el.getBoundingClientRect())
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

/** Reads an integer line attribute, returning null when absent or unparseable. */
function lineAttr(element: HTMLElement, name: string): number | null {
  const raw = element.getAttribute(name)
  if (raw === null) return null
  const value = Number.parseInt(raw, 10)
  return Number.isNaN(value) ? null : value
}
