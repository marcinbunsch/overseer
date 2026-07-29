/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { MessageItem } from "../MessageItem"
import { TurnSection } from "../TurnSection"
import { chatSearchStore } from "../../../stores/ChatSearchStore"
import type { Message, MessageTurn } from "../../../types"

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}))
vi.mock("react-syntax-highlighter/dist/esm/prism", () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}))
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }))

afterEach(() => {
  // Unmount observers before flipping the store, so the reset doesn't re-render outside act().
  cleanup()
  chatSearchStore.reset()
})

const bashOutput = (content: string): Message => ({
  id: "b1",
  role: "assistant",
  content,
  timestamp: new Date(),
  isBashOutput: true,
})

// 5 lines exceeds the 3-line collapse threshold.
const LONG_OUTPUT = "line1\nline2\nline3\nline4\nline5"

describe("bash output force-expand during search", () => {
  it("stays collapsed when search is inactive", () => {
    chatSearchStore.close()
    render(<MessageItem message={bashOutput(LONG_OUTPUT)} />)
    expect(screen.getByText(/Show 2 more lines/)).toBeInTheDocument()
  })

  it("shows full output with the collapse toggle disabled when search is active", () => {
    chatSearchStore.open()
    render(<MessageItem message={bashOutput(LONG_OUTPUT)} />)
    expect(screen.queryByText(/Show 2 more lines/)).not.toBeInTheDocument()
    const collapse = screen.getByText("Collapse output").closest("button")
    expect(collapse).toBeDisabled()
  })
})

const turn = (): MessageTurn => ({
  userMessage: { id: "u1", role: "user", content: "do the thing", timestamp: new Date() },
  workMessages: [
    { id: "w1", role: "assistant", content: "digging through logs", timestamp: new Date() },
  ],
  resultMessage: { id: "r1", role: "assistant", content: "done", timestamp: new Date() },
  inProgress: false,
})

describe("turn work section force-expand during search", () => {
  it("hides work messages when search is inactive", () => {
    chatSearchStore.close()
    render(<TurnSection turn={turn()} />)
    expect(screen.queryByText("digging through logs")).not.toBeInTheDocument()
  })

  it("reveals work messages when search is active", () => {
    chatSearchStore.open()
    render(<TurnSection turn={turn()} />)
    expect(screen.getByText("digging through logs")).toBeInTheDocument()
  })
})
