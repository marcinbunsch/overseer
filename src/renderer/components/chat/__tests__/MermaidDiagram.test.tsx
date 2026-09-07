/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

// Mock mermaid at the module boundary (SCRATCHPAD: mock heavy rendering libs).
// vi.hoisted lets the hoisted vi.mock factories reference these safely.
const { initialize, parse, render_, themeControllerMock } = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn<(code: string) => Promise<boolean>>(),
  render_: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(),
  themeControllerMock: { effectiveTheme: "dark" as "dark" | "light" },
}))

vi.mock("mermaid", () => ({
  default: { initialize, parse, render: render_ },
}))

// Control effectiveTheme without the real matchMedia-driven controller.
vi.mock("../../../services/themeController", () => ({
  themeController: themeControllerMock,
}))

import { MermaidDiagram } from "../MermaidDiagram"

const DIAGRAM = "flowchart TD\n  A --> B"

describe("MermaidDiagram", () => {
  beforeEach(() => {
    initialize.mockClear()
    parse.mockReset()
    render_.mockReset()
    themeControllerMock.effectiveTheme = "dark"
  })

  it("valid source -> renders the produced svg", async () => {
    parse.mockResolvedValue(true)
    render_.mockResolvedValue({ svg: '<svg data-testid="rendered-svg"></svg>' })

    render(<MermaidDiagram code={DIAGRAM} />)

    expect(await screen.findByTestId("rendered-svg")).toBeInTheDocument()
    expect(screen.queryByTestId("mermaid-fallback")).not.toBeInTheDocument()
  })

  it("incomplete source (parse rejects) -> shows raw code fallback, no svg", async () => {
    // Mid-stream: the block is not yet valid mermaid.
    parse.mockRejectedValue(new Error("Parse error"))

    render(<MermaidDiagram code={"flowchart TD\n  A --"} />)

    expect(await screen.findByTestId("mermaid-fallback")).toBeInTheDocument()
    expect(render_).not.toHaveBeenCalled()
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument()
  })

  it("light theme -> initializes mermaid with the default (light) theme", async () => {
    themeControllerMock.effectiveTheme = "light"
    parse.mockResolvedValue(true)
    render_.mockResolvedValue({ svg: '<svg data-testid="rendered-svg"></svg>' })

    render(<MermaidDiagram code={DIAGRAM} />)

    await screen.findByTestId("rendered-svg")
    await waitFor(() =>
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "default" }))
    )
  })

  it("dark theme -> initializes mermaid with the dark theme", async () => {
    parse.mockResolvedValue(true)
    render_.mockResolvedValue({ svg: '<svg data-testid="rendered-svg"></svg>' })

    render(<MermaidDiagram code={DIAGRAM} />)

    await screen.findByTestId("rendered-svg")
    await waitFor(() =>
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }))
    )
  })

  it("clicking the diagram opens the enlarge dialog", async () => {
    parse.mockResolvedValue(true)
    render_.mockResolvedValue({ svg: '<svg data-testid="rendered-svg"></svg>' })

    render(<MermaidDiagram code={DIAGRAM} />)
    await screen.findByTestId("mermaid-diagram")

    // Dialog is not mounted until the diagram is clicked.
    expect(screen.queryByTestId("mermaid-dialog-diagram")).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId("mermaid-diagram"))

    expect(await screen.findByTestId("mermaid-dialog-diagram")).toBeInTheDocument()
  })

  it("does not render a dialog while showing the raw-code fallback", async () => {
    parse.mockRejectedValue(new Error("Parse error"))

    render(<MermaidDiagram code={"flowchart TD\n  A --"} />)

    await screen.findByTestId("mermaid-fallback")
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument()
    expect(screen.queryByTestId("mermaid-dialog-diagram")).not.toBeInTheDocument()
  })
})
