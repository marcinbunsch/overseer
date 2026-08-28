/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { Message } from "../../../types"
import { AutonomousMessage, isAutonomousMessage } from "../AutonomousMessage"

const continueAutonomousRun = vi.fn()
let autonomousRunning = false

vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    get selectedWorkspaceStore() {
      return {
        continueAutonomousRun,
        get activeChat() {
          return { autonomousRunning }
        },
      }
    },
  },
}))

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

  beforeEach(() => {
    continueAutonomousRun.mockClear()
    autonomousRunning = false
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

  it("shows a Continue button only when the run hit the iteration cap", () => {
    const capped: Message = {
      ...createMessage("autonomous-complete", "Autonomous Mode Complete — Max iterations reached"),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType: "autonomous-complete",
        iteration: 25,
        maxIterations: 25,
        maxIterationsReached: true,
      },
    }
    render(<AutonomousMessage message={capped} />)
    expect(screen.getByTestId("autonomous-continue-button")).toBeInTheDocument()
  })

  it("hides the Continue button on a normal completion", () => {
    const finished = createMessage(
      "autonomous-complete",
      "Autonomous Mode Complete — Task finished"
    )
    render(<AutonomousMessage message={finished} />)
    expect(screen.queryByTestId("autonomous-continue-button")).not.toBeInTheDocument()
  })

  it("continues with the meta's max iterations and review config on click", () => {
    const capped: Message = {
      id: "test-id",
      role: "user",
      content: "Autonomous Mode Complete — Max iterations reached",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType: "autonomous-complete",
        iteration: 5,
        maxIterations: 5,
        maxIterationsReached: true,
        reviewAgentType: "gemini",
        reviewModelVersion: "gemini-2.5-pro",
      },
    }
    render(<AutonomousMessage message={capped} />)

    fireEvent.click(screen.getByTestId("autonomous-continue-button"))

    expect(continueAutonomousRun).toHaveBeenCalledWith(
      5,
      {
        agentType: "gemini",
        modelVersion: "gemini-2.5-pro",
      },
      undefined
    )
  })

  it("disables the Continue button while a run is active", () => {
    autonomousRunning = true
    const capped: Message = {
      id: "test-id",
      role: "user",
      content: "Autonomous Mode Complete — Max iterations reached",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType: "autonomous-complete",
        iteration: 25,
        maxIterations: 25,
        maxIterationsReached: true,
      },
    }
    render(<AutonomousMessage message={capped} />)

    expect(screen.getByTestId("autonomous-continue-button")).toBeDisabled()
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

  it("renders a gauntlet-round message", () => {
    const message: Message = {
      id: "g-round",
      role: "user",
      content: "🛡️ **Gauntlet round 1** — running 3 reviewers",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Gauntlet",
        autonomousType: "gauntlet-round",
        gauntletRound: 1,
      },
    }
    render(<AutonomousMessage message={message} />)
    expect(screen.getByTestId("autonomous-message-gauntlet-round")).toBeInTheDocument()
    expect(screen.getByText(/Gauntlet round 1/)).toBeInTheDocument()
  })

  it("renders a gauntlet-verdict message", () => {
    const message: Message = {
      id: "g-verdict",
      role: "user",
      content: "⚠️ **Security Review** found issues",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Gauntlet",
        autonomousType: "gauntlet-verdict",
        gauntletReviewerName: "Security Review",
        gauntletVerdict: "fail",
      },
    }
    render(<AutonomousMessage message={message} />)
    expect(screen.getByTestId("autonomous-message-gauntlet-verdict")).toBeInTheDocument()
    expect(screen.getByText(/Security Review/)).toBeInTheDocument()
  })

  it("re-arms the gauntlet from a cap-hit completion's meta", () => {
    const reviewers = [
      {
        id: "r1",
        name: "Code Review",
        prompt: "p",
        agentType: "claude" as const,
        modelVersion: null,
        enabled: true,
      },
    ]
    const message: Message = {
      id: "complete",
      role: "user",
      content: "Autonomous Mode Complete — Max iterations reached",
      timestamp: new Date(),
      meta: {
        type: "system",
        label: "Autonomous",
        autonomousType: "autonomous-complete",
        maxIterations: 25,
        maxIterationsReached: true,
        gauntletReviewers: reviewers,
      },
    }
    render(<AutonomousMessage message={message} />)
    fireEvent.click(screen.getByTestId("autonomous-continue-button"))
    expect(continueAutonomousRun).toHaveBeenCalledWith(25, undefined, reviewers)
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
