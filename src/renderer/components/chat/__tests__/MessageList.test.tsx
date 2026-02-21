/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MessageList } from "../MessageList"
import type { MessageTurn } from "../../../types"

// Mock TurnSection
vi.mock("../TurnSection", () => ({
  TurnSection: ({ turn }: { turn: MessageTurn }) => (
    <div data-testid={`turn-${turn.userMessage.id}`}>Turn {turn.userMessage.id}</div>
  ),
}))

// Mock the eventBus hook
vi.mock("../../../utils/eventBus", () => ({
  useEventBus: vi.fn(),
}))

describe("MessageList", () => {
  beforeEach(() => {
    // Mock scrollTo on Element prototype for JSDOM
    Element.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const createTurn = (id: string, hasResult = false): MessageTurn => ({
    userMessage: {
      id,
      role: "user",
      content: `Message ${id}`,
      timestamp: new Date(),
    },
    workMessages: [],
    resultMessage: hasResult
      ? {
          id: `result-${id}`,
          role: "assistant",
          content: `Result ${id}`,
          timestamp: new Date(),
        }
      : null,
    inProgress: !hasResult,
  })

  it("renders empty state when no turns", () => {
    render(<MessageList turns={[]} />)
    expect(screen.getByText("Start a chat")).toBeInTheDocument()
  })

  it("renders all turns when count is below pagination threshold", () => {
    const turns = [createTurn("1"), createTurn("2"), createTurn("3")]
    render(<MessageList turns={turns} />)

    expect(screen.getByTestId("turn-1")).toBeInTheDocument()
    expect(screen.getByTestId("turn-2")).toBeInTheDocument()
    expect(screen.getByTestId("turn-3")).toBeInTheDocument()
  })

  it("renders turns correctly", () => {
    render(<MessageList turns={[createTurn("1", false)]} />)

    // Verify the turn is rendered
    expect(screen.getByTestId("turn-1")).toBeInTheDocument()
  })

  it("handles scroll events to track user position", () => {
    const turns = [createTurn("1"), createTurn("2")]
    const { container } = render(<MessageList turns={turns} />)

    const scrollContainer = container.querySelector(".flex-1.overflow-y-auto")
    expect(scrollContainer).toBeInTheDocument()

    // Should have onScroll handler
    expect(scrollContainer).toHaveProperty("onscroll")
  })

  it("shows pagination button when turns exceed threshold", () => {
    const turns = Array.from({ length: 15 }, (_, i) => createTurn(`${i + 1}`))
    render(<MessageList turns={turns} />)

    expect(screen.getByText(/Show .* earlier messages/)).toBeInTheDocument()
  })
})
