/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { toolAvailabilityStore } from "../../../stores/ToolAvailabilityStore"
import { AgentIcon } from "../AgentIcon"

describe("AgentIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    toolAvailabilityStore.claude = null
    toolAvailabilityStore.codex = null
  })

  it("renders Claude icon without warning when showWarning is false", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "not found",
      lastChecked: Date.now(),
    }

    render(<AgentIcon agentType="claude" size={14} />)

    expect(screen.getByLabelText("Claude")).toBeInTheDocument()
    expect(screen.queryByLabelText("Warning")).not.toBeInTheDocument()
  })

  it("shows warning icon when agent is unavailable and showWarning is true", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "command not found",
      lastChecked: Date.now(),
    }

    render(<AgentIcon agentType="claude" size={14} showWarning />)

    expect(screen.getByLabelText("Claude")).toBeInTheDocument()
    expect(screen.getByLabelText("Warning")).toBeInTheDocument()
  })

  it("does not show warning when agent status is null (not checked)", () => {
    toolAvailabilityStore.claude = null

    render(<AgentIcon agentType="claude" size={14} showWarning />)

    expect(screen.getByLabelText("Claude")).toBeInTheDocument()
    expect(screen.queryByLabelText("Warning")).not.toBeInTheDocument()
  })

  it("does not show warning when agent is available", () => {
    toolAvailabilityStore.claude = {
      available: true,
      version: "1.0.0",
      lastChecked: Date.now(),
    }

    render(<AgentIcon agentType="claude" size={14} showWarning />)

    expect(screen.getByLabelText("Claude")).toBeInTheDocument()
    expect(screen.queryByLabelText("Warning")).not.toBeInTheDocument()
  })

  it("shows warning for Codex when unavailable", () => {
    toolAvailabilityStore.codex = {
      available: false,
      error: "codex not installed",
      lastChecked: Date.now(),
    }

    render(<AgentIcon agentType="codex" size={14} showWarning />)

    expect(screen.getByLabelText("OpenAI")).toBeInTheDocument()
    expect(screen.getByLabelText("Warning")).toBeInTheDocument()
  })

  it("displays error message in title attribute", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "claude binary not found at /path/to/claude",
      lastChecked: Date.now(),
    }

    render(<AgentIcon agentType="claude" size={14} showWarning />)

    const wrapper = screen.getByTitle("claude binary not found at /path/to/claude")
    expect(wrapper).toBeInTheDocument()
  })
})
