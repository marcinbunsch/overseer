import type { Root, RootContent, Element, ElementContent } from "hast"

/**
 * Rehype plugin that stamps each element with the source line range it came from,
 * as `data-src-start` / `data-src-end` (1-based, inclusive).
 *
 * remark records source positions on every node during parsing and they survive the
 * mdast->hast transform, so we read them straight off `node.position`. The rendered DOM
 * then carries the true source range on every block, which lets a text selection in the
 * preview be mapped back to plan line numbers without string-matching the content.
 *
 * Elements synthesised by other plugins have no `position`; those are left untouched.
 */
export function rehypeSourceLines() {
  return function transform(tree: Root): void {
    stampChildren(tree.children)
  }
}

function stampChildren(children: Array<RootContent | ElementContent>): void {
  for (const child of children) {
    if (child.type !== "element") continue
    stampElement(child)
    stampChildren(child.children)
  }
}

function stampElement(element: Element): void {
  const position = element.position
  if (!position) return

  // hast serialises `dataSrcStart` -> `data-src-start` in the rendered DOM.
  element.properties = element.properties ?? {}
  element.properties.dataSrcStart = position.start.line
  element.properties.dataSrcEnd = position.end.line
}
