/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AutonomousDialog } from "../AutonomousDialog"
import { gauntletStore } from "../../../stores/GauntletStore"

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

// Start each test with a clean, empty gauntlet reviewer list.
beforeEach(() => {
  gauntletStore.initFromConfig([])
  gauntletStore.reviewers.forEach((r) => gauntletStore.removeReviewer(r.id))
})

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

    expect(onStart).toHaveBeenCalledWith("Test prompt", 25, undefined, undefined)
  })

  it("calls onStart with custom maxIterations", () => {
    const onStart = vi.fn()
    render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

    const input = screen.getByTestId("autonomous-max-iterations-input")
    fireEvent.change(input, { target: { value: "10" } })
    fireEvent.click(screen.getByTestId("autonomous-start-button"))

    expect(onStart).toHaveBeenCalledWith("Test prompt", 10, undefined, undefined)
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

      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, undefined, undefined)
    })

    it("passes reviewConfig with default claude agent and null model when checkbox enabled", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))
      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith(
        "Test prompt",
        25,
        {
          agentType: "claude",
          modelVersion: null,
        },
        undefined
      )
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

      expect(onStart).toHaveBeenCalledWith(
        "Test prompt",
        25,
        {
          agentType: "claude",
          modelVersion: null,
        },
        undefined
      )
    })

    it("passes selected model version when a model is chosen", () => {
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      // Open ModelSelector dropdown and pick "Haiku 4.5"
      fireEvent.click(screen.getByTestId("model-selector"))
      fireEvent.click(screen.getByTestId("model-option-claude-haiku-4-5"))

      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      expect(onStart).toHaveBeenCalledWith(
        "Test prompt",
        25,
        {
          agentType: "claude",
          modelVersion: "claude-haiku-4-5",
        },
        undefined
      )
    })

    it("shows agent type selector when checkbox is enabled", () => {
      render(<AutonomousDialog {...defaultProps} />)

      fireEvent.click(screen.getByTestId("autonomous-use-review-agent-checkbox"))

      expect(screen.getByTestId("autonomous-review-agent-select")).toBeInTheDocument()
    })
  })

  describe("gauntlet review configuration", () => {
    const seedReviewers = () => {
      gauntletStore.addReviewer({
        name: "Code Review",
        prompt: "check correctness",
        agentType: "claude",
        modelVersion: null,
        enabled: true,
      })
      gauntletStore.addReviewer({
        name: "Security Review",
        prompt: "check security",
        agentType: "claude",
        modelVersion: null,
        enabled: false,
      })
    }

    it("reveals the reviewer checklist when enabled and defaults to enabled reviewers", () => {
      seedReviewers()
      render(<AutonomousDialog {...defaultProps} />)

      const [codeReview, securityReview] = gauntletStore.reviewers
      expect(screen.queryByTestId(`gauntlet-select-${codeReview.id}`)).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId("autonomous-use-gauntlet-checkbox"))

      const codeCheckbox = screen
        .getByTestId(`gauntlet-select-${codeReview.id}`)
        .querySelector("input") as HTMLInputElement
      const securityCheckbox = screen
        .getByTestId(`gauntlet-select-${securityReview.id}`)
        .querySelector("input") as HTMLInputElement
      // Only the enabled reviewer is pre-selected.
      expect(codeCheckbox.checked).toBe(true)
      expect(securityCheckbox.checked).toBe(false)
    })

    it("passes the selected reviewers and no reviewConfig when gauntlet is on", () => {
      seedReviewers()
      const onStart = vi.fn()
      render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

      fireEvent.click(screen.getByTestId("autonomous-use-gauntlet-checkbox"))
      fireEvent.click(screen.getByTestId("autonomous-start-button"))

      const [codeReview] = gauntletStore.reviewers
      expect(onStart).toHaveBeenCalledWith("Test prompt", 25, undefined, [
        expect.objectContaining({ id: codeReview.id, name: "Code Review" }),
      ])
    })

    it("is mutually exclusive with the single review agent option", () => {
      seedReviewers()
      render(<AutonomousDialog {...defaultProps} />)

      const gauntletCheckbox = screen.getByTestId(
        "autonomous-use-gauntlet-checkbox"
      ) as HTMLInputElement
      const reviewCheckbox = screen.getByTestId(
        "autonomous-use-review-agent-checkbox"
      ) as HTMLInputElement

      fireEvent.click(reviewCheckbox)
      expect(reviewCheckbox.checked).toBe(true)

      fireEvent.click(gauntletCheckbox)
      expect(gauntletCheckbox.checked).toBe(true)
      expect(reviewCheckbox.checked).toBe(false)
    })

    it("disables Start when gauntlet is on but no reviewer is selected", () => {
      seedReviewers()
      render(<AutonomousDialog {...defaultProps} />)

      fireEvent.click(screen.getByTestId("autonomous-use-gauntlet-checkbox"))

      const [codeReview] = gauntletStore.reviewers
      // Uncheck the only pre-selected reviewer.
      const codeCheckbox = screen
        .getByTestId(`gauntlet-select-${codeReview.id}`)
        .querySelector("input") as HTMLInputElement
      fireEvent.click(codeCheckbox)

      expect(screen.getByTestId("autonomous-start-button")).toBeDisabled()
    })
  })
})
