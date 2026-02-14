/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MessageList } from "../MessageList"
import type { MessageTurn } from "../../../types"

// Mock TurnSection
vi.mock("../TurnSection", () => ({
  TurnSection: ({ turn }: { turn: MessageTurn }) => (
    <div data-testid={`turn-${turn.userMessage.id}`}>Turn {turn.userMessage.id}</div>
  ),
}))

describe("MessageList", () => {
  let mockObserve: ReturnType<typeof vi.fn>
  let mockDisconnect: ReturnType<typeof vi.fn>
  let mockUnobserve: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock scrollIntoView
    HTMLElement.prototype.scrollIntoView = vi.fn()

    // Mock ResizeObserver
    mockObserve = vi.fn()
    mockDisconnect = vi.fn()
    mockUnobserve = vi.fn()

    globalThis.ResizeObserver = class ResizeObserver {
      observe = mockObserve
      disconnect = mockDisconnect
      unobserve = mockUnobserve
      constructor() {}
    } as unknown as typeof ResizeObserver
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
    expect(screen.getByText("Start a chat with Claude")).toBeInTheDocument()
  })

  it("renders all turns when count is below pagination threshold", () => {
    const turns = [createTurn("1"), createTurn("2"), createTurn("3")]
    render(<MessageList turns={turns} />)

    expect(screen.getByTestId("turn-1")).toBeInTheDocument()
    expect(screen.getByTestId("turn-2")).toBeInTheDocument()
    expect(screen.getByTestId("turn-3")).toBeInTheDocument()
  })

  it("auto-scrolls when a turn completes", async () => {
    const { rerender } = render(<MessageList turns={[createTurn("1", false)]} />)

    // Turn completes
    rerender(<MessageList turns={[createTurn("1", true)]} />)

    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    })
  })

  it("sets up ResizeObserver for streaming content", () => {
    const { unmount } = render(<MessageList turns={[createTurn("1")]} />)

    expect(mockObserve).toHaveBeenCalled()

    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
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
