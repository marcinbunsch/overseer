/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { rehypeStripBlockWhitespace } from "../rehypeStripBlockWhitespace"

function whitespaceTextNodes(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const blanks: string[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? ""
    if (value.length > 0 && value.trim() === "") blanks.push(value)
  }
  return blanks
}

describe("rehypeStripBlockWhitespace", () => {
  it("removes the newline text nodes react-markdown emits between blocks", () => {
    const md = "First paragraph.\n\n- item one\n- item two\n\nLast paragraph."

    const withPlugin = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeStripBlockWhitespace]}>
        {md}
      </ReactMarkdown>
    )
    expect(whitespaceTextNodes(withPlugin.container)).toEqual([])

    // Sanity: without the plugin, react-markdown does emit whitespace text nodes.
    const without = render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>)
    expect(whitespaceTextNodes(without.container).length).toBeGreaterThan(0)
  })

  it("keeps significant whitespace between inline content", () => {
    // The spaces around the link and code must survive, or words would run together.
    const md = "Run `pnpm test` and then [open the app](https://example.com) to check."
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeStripBlockWhitespace]}>
        {md}
      </ReactMarkdown>
    )

    const paragraph = container.querySelector("p")!
    // Rendered text keeps the single spaces between the inline pieces.
    expect(paragraph.textContent).toBe("Run pnpm test and then open the app to check.")
  })
})
