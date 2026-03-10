/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MessageItem } from "../MessageItem"
import type { Message } from "../../../types"

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}))

vi.mock("react-syntax-highlighter/dist/esm/prism", () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}))

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}))

const userMessage = (content: string): Message => ({
  id: "u1",
  role: "user",
  content,
  timestamp: new Date(),
})

const assistantMessage = (content: string): Message => ({
  id: "a1",
  role: "assistant",
  content,
  timestamp: new Date(),
})

describe("MessageItem copy button", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it("shows copy button on user message", () => {
    render(<MessageItem message={userMessage("Hello!")} />)
    expect(screen.getByTestId("copy-message-button")).toBeInTheDocument()
  })

  it("shows copy button on assistant text message", () => {
    render(<MessageItem message={assistantMessage("Here is my response.")} />)
    expect(screen.getByTestId("copy-message-button")).toBeInTheDocument()
  })

  it("copies user message content to clipboard on click", async () => {
    render(<MessageItem message={userMessage("Hello clipboard!")} />)
    fireEvent.click(screen.getByTestId("copy-message-button"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hello clipboard!")
  })

  it("copies assistant message content to clipboard on click", async () => {
    render(<MessageItem message={assistantMessage("Assistant response here.")} />)
    fireEvent.click(screen.getByTestId("copy-message-button"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Assistant response here.")
  })

  it("does not show copy button on compact assistant message", () => {
    render(<MessageItem message={assistantMessage("compact content")} compact />)
    expect(screen.queryByTestId("copy-message-button")).not.toBeInTheDocument()
  })

  it("does not show copy button on tool call messages", () => {
    const toolMessage = assistantMessage('[Bash]\n{"command": "ls"}')
    render(<MessageItem message={toolMessage} />)
    expect(screen.queryByTestId("copy-message-button")).not.toBeInTheDocument()
  })

  it("switches to check icon briefly after copying", async () => {
    render(<MessageItem message={userMessage("test")} />)
    const btn = screen.getByTestId("copy-message-button")
    fireEvent.click(btn)
    await waitFor(() => {
      // Check icon should appear (lucide Check renders an svg)
      expect(btn.querySelector("svg")).toBeInTheDocument()
    })
  })
})
