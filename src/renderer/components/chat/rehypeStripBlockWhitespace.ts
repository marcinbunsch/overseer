import type { Root, Element, RootContent, ElementContent } from "hast"

const isBlankText = (child: RootContent | ElementContent): boolean =>
  child.type === "text" && child.value.trim() === ""

// Containers whose direct text children are only insignificant layout whitespace (the "\n"
// react-markdown emits between block elements). Inline containers like <p>/<li>/<h1> keep
// their whitespace — it separates words and inline nodes and must not be touched.
const BLOCK_CONTAINERS = new Set(["ul", "ol", "table", "thead", "tbody", "tr", "blockquote"])

/**
 * Removes whitespace-only text nodes sitting between block elements. Those nodes render as
 * nothing, but web-highlighter would wrap them in <mark> when a selection spans blocks,
 * producing stray highlighted slivers that wreck the layout. Dropping them makes the DOM
 * match what a browser keeps for block content, so there is nothing spurious to highlight.
 */
export function rehypeStripBlockWhitespace() {
  return function transform(tree: Root): void {
    stripWhitespace(tree)
  }
}

function stripWhitespace(node: Root | Element): void {
  if (node.type === "root") {
    node.children = node.children.filter((child) => !isBlankText(child))
  } else if (BLOCK_CONTAINERS.has(node.tagName)) {
    node.children = node.children.filter((child) => !isBlankText(child))
  }

  for (const child of node.children) {
    if (child.type === "element") stripWhitespace(child)
  }
}
