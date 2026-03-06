/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AutonomousDialog } from "../AutonomousDialog"

vi.mock("../../../stores/ConfigStore", () => ({
  configStore: {
    enabledAgents: ["claude", "gemini"],
    claudeModels: [{ alias: "claude-haiku-4-5", displayName: "Haiku 4.5" }],
    geminiModels: [{ alias: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }],
    codexModels: [],
    copilotModels: [],
    opencodeModels: [],
    getModelsForAgent: (agentType: string) => {
      if (agentType === "gemini")
        return [{ alias: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }]
      return [{ alias: "claude-haiku-4-5", displayName: "Haiku 4.5" }]
    },
  },
}))

describe("AutonomousDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    initialPrompt: "Test prompt",
    onStart: vi.fn(),
  }

  it("renders with initial prompt", () => {
    render(<AutonomousDialog {...defaultProps} />)

    expect(screen.getByTestId("autonomous-prompt-input")).toHaveValue("Test prompt")
  })

  it("shows default max iterations of 25", () => {
    render(<AutonomousDialog {...defaultProps} />)

    expect(screen.getByTestId("autonomous-max-iterations-input")).toHaveValue(25)
  })

  it("shows YOLO mode warning", () => {
    render(<AutonomousDialog {...defaultProps} />)

    expect(screen.getByText(/YOLO mode enabled/)).toBeInTheDocument()
  })

  it("calls onStart with prompt and maxIterations", () => {
    const onStart = vi.fn()
    render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

    fireEvent.click(screen.getByTestId("autonomous-start-button"))

    expect(onStart).toHaveBeenCalledWith("Test prompt", 25, undefined)
  })

  it("calls onStart with custom maxIterations", () => {
    const onStart = vi.fn()
    render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

    const input = screen.getByTestId("autonomous-max-iterations-input")
    fireEvent.change(input, { target: { value: "10" } })
    fireEvent.click(screen.getByTestId("autonomous-start-button"))

    expect(onStart).toHaveBeenCalledWith("Test prompt", 10, undefined)
  })

  it("does not call onStart with empty prompt", () => {
    const onStart = vi.fn()
    render(<AutonomousDialog {...defaultProps} initialPrompt="" onStart={onStart} />)

    expect(screen.getByTestId("autonomous-start-button")).toBeDisabled()
  })

  it("allows editing the prompt", () => {
    render(<AutonomousDialog {...defaultProps} />)

    const textarea = screen.getByTestId("autonomous-prompt-input")
    fireEvent.change(textarea, { target: { value: "New prompt" } })

    expect(textarea).toHaveValue("New prompt")
  })

  it("closes dialog when cancel is clicked", () => {
    const onOpenChange = vi.fn()
    render(<AutonomousDialog {...defaultProps} onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText("Cancel"))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  describe("review agent configuration", () => {
    it("passes undefined reviewConfig when checkbox is not enabled", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, undefined)
    })

    it("passes reviewConfig with default claude agent and null model when checkbox enabled", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))
      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, {
        agentType: "claude",
        modelVersion: null,
      })
    })

    it("shows model selector when checkbox is enabled", () => {
      render(<AutonomousDialog {...defaultProps} />)

      expect(screen.queryByTestId("model-selector")).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      expect(screen.getByTestId("model-selector")).toBeInTheDocument()
    })

    it("passes null modelVersion when Default model is selected", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      // Model starts at Default (null) — click Start without picking a model
      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, {
        agentType: "claude",
        modelVersion: null,
      })
    })

    it("passes selected model version when a model is chosen", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      // Open ModelSelector dropdown and pick "Haiku 4.5"
      fireEvent.click(screen.getByTestId("model-selector"))
      fireEvent.click(screen.getByTestId("model-option-claude-haiku-4-5"))

      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, {
        agentType: "claude",
        modelVersion: "claude-haiku-4-5",
      })
    })

    it("shows agent type selector when checkbox is enabled", () => {
      render(<AutonomousDialog {...defaultProps} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      expect(screen.getByTestId("autonomous-review-agent-select")).toBeInTheDocument()
    })
  })
})
