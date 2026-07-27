/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AgentQuestionPanel } from "../AgentQuestionPanel"
import type { AgentQuestion } from "../../../types"

// react-markdown pulls in ESM-only deps; render children as plain text.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}))

function buildQuestions(count: number): AgentQuestion["questions"] {
  return Array.from({ length: count }, (_, i) => ({
    question: `Question number ${i}?`,
    header: `header-${i}`,
    options: [
      { label: `Option A${i}`, description: "First choice" },
      { label: `Option B${i}`, description: "Second choice" },
    ],
    multiSelect: false,
  }))
}

describe("AgentQuestionPanel", () => {
  it("renders nothing when there are no pending questions", () => {
    const { container } = render(<AgentQuestionPanel pendingQuestions={[]} onAnswer={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  // Regression: many questions overflowed the panel with no way to scroll to
  // Submit, which made the UI unusable. The panel must cap its height and scroll.
  it("caps its height and scrolls when questions overflow", () => {
    const agentQuestion: AgentQuestion = {
      id: "tool-use-1",
      questions: buildQuestions(8),
      rawInput: {},
    }
    render(<AgentQuestionPanel pendingQuestions={[agentQuestion]} onAnswer={vi.fn()} />)

    const panel = screen.getByTestId("agent-question-panel")
    expect(panel.className).toContain("overflow-y-auto")
    expect(panel.className).toContain("max-h-[50vh]")
    // Submit lives at the bottom of the scroll area and stays in the DOM.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument()
  })
})
