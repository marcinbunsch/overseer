/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Root } from "hast"
import { rehypeSourceLines } from "../rehypeSourceLines"

describe("rehypeSourceLines", () => {
  // Spike: proves react-markdown v10 still exposes node.position, so the plugin can
  // stamp real source line numbers onto the rendered DOM.
  it("stamps data-src-start/end on rendered blocks from real markdown", () => {
    const plan = "# Title\n\nFirst paragraph.\n\n- item one\n- item two"
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSourceLines]}>
        {plan}
      </ReactMarkdown>
    )

    const heading = container.querySelector("h1")
    expect(heading?.getAttribute("data-src-start")).toBe("1")
    expect(heading?.getAttribute("data-src-end")).toBe("1")

    const paragraph = container.querySelector("p")
    expect(paragraph?.getAttribute("data-src-start")).toBe("3")

    // The list starts on source line 5 (1-based).
    const list = container.querySelector("ul")
    expect(list?.getAttribute("data-src-start")).toBe("5")
  })

  it("leaves elements without a position untouched", () => {
    // A hast element with no `position` (e.g. one synthesised by another plugin).
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "div",
          properties: {},
          children: [],
        },
      ],
    }

    rehypeSourceLines()(tree)

    const div = tree.children[0]
    expect(div.type).toBe("element")
    if (div.type === "element") {
      expect(div.properties.dataSrcStart).toBeUndefined()
      expect(div.properties.dataSrcEnd).toBeUndefined()
    }
  })
})
