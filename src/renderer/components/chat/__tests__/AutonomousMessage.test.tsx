/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { Message } from "../../../types"
import { AutonomousMessage, isAutonomousMessage } from "../AutonomousMessage"

describe("AutonomousMessage", () => {
  const createMessage = (
    autonomousType:
      | "autonomous-start"
      | "autonomous-loop"
      | "autonomous-complete"
      | "autonomous-stopped",
    content: string
  ): Message => ({
    id: "test-id",
    role: "user",
    content,
    timestamp: new Date(),
    meta: {
      type: "system",
      label: "Autonomous",
      autonomousType,
      iteration: 1,
      maxIterations: 25,
    },
  })

  it("renders autonomous-start message", () => {
    const message = createMessage("autonomous-start", "Autonomous Mode Started — Max 25 iterations")
    render(<AutonomousMessage message={message} />)

    expect(screen.getByTestId("autonomous-message-autonomous-start")).toBeInTheDocument()
    expect(screen.getByText(/Autonomous Mode Started/)).toBeInTheDocument()
  })

  it("renders autonomous-loop message with expandable prompt", () => {
    // Content is the loop prompt, header is generated from meta.iteration/maxIterations
    const message = createMessage("autonomous-loop", "You are running in **Autonomous Mode**...")
    render(<AutonomousMessage message={message} />)

    expect(screen.getByTestId("autonomous-message-autonomous-loop")).toBeInTheDocument()
    // Header is generated from meta values (iteration=1, maxIterations=25)
    expect(screen.getByText(/Iteration 1 of 25/)).toBeInTheDocument()
  })

  it("shows review agent label in loop message header during review phase", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "Review prompt content",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Review Step",
        autonomousType: "autonomous-loop",
        iteration: 2,
        maxIterations: 5,
        phase: "review",
        reviewAgentLabel: "Gemini 2.5 Pro",
      },
    }
    render(<AutonomousMessage message={message} />)

    expect(screen.getByText(/Review via Gemini 2.5 Pro/)).toBeInTheDocument()
    expect(screen.getByText(/Iteration 2 of 5/)).toBeInTheDocument()
  })

  it("shows plain Review label when phase is review but no reviewAgentLabel", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "Review prompt content",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Review Step",
        autonomousType: "autonomous-loop",
        iteration: 3,
        maxIterations: 5,
        phase: "review",
      },
    }
    render(<AutonomousMessage message={message} />)

    expect(screen.getByText(/\(Review\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Review via/)).not.toBeInTheDocument()
  })

  it("renders autonomous-complete message", () => {
    const message = createMessage("autonomous-complete", "Autonomous Mode Complete — Task finished")
    render(<AutonomousMessage message={message} />)

    expect(screen.getByTestId("autonomous-message-autonomous-complete")).toBeInTheDocument()
    expect(screen.getByText(/Autonomous Mode Complete/)).toBeInTheDocument()
  })

  it("renders autonomous-stopped message", () => {
    const message = createMessage(
      "autonomous-stopped",
      "Autonomous Mode Stopped — Stopped at iteration 5"
    )
    render(<AutonomousMessage message={message} />)

    expect(screen.getByTestId("autonomous-message-autonomous-stopped")).toBeInTheDocument()
    expect(screen.getByText(/Autonomous Mode Stopped/)).toBeInTheDocument()
  })

  it("returns null for message without autonomousType", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "Regular message",
      timestamp: new Date(),
    }
    const { container } = render(<AutonomousMessage message={message} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("isAutonomousMessage", () => {
  it("returns true for messages with autonomousType", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "test",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType: "autonomous-start",
      },
    }
    expect(isAutonomousMessage(message)).toBe(true)
  })

  it("returns false for messages without meta", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "test",
      timestamp: new Date(),
    }
    expect(isAutonomousMessage(message)).toBe(false)
  })

  it("returns false for messages with meta but no autonomousType", () => {
    const message: Message = {
      id: "test-id",
      role: "user",
      content: "test",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Test",
      },
    }
    expect(isAutonomousMessage(message)).toBe(false)
  })
})
