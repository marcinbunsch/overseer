/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GauntletRunDialog } from "../GauntletRunDialog"
import { gauntletStore } from "../../../stores/GauntletStore"

beforeEach(() => {
  gauntletStore.initFromConfig([])
  gauntletStore.reviewers.forEach((r) => gauntletStore.removeReviewer(r.id))
})

const seed = () => {
  gauntletStore.addReviewer({
    name: "Code Review",
    prompt: "correctness",
    agentType: "claude",
    modelVersion: null,
    enabled: true,
  })
  gauntletStore.addReviewer({
    name: "Security Review",
    prompt: "security",
    agentType: "claude",
    modelVersion: null,
    enabled: false,
  })
}

describe("GauntletRunDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onRun: vi.fn(),
  }

  it("defaults selection to enabled reviewers", () => {
    seed()
    render(<GauntletRunDialog {...defaultProps} />)
    const [code, security] = gauntletStore.reviewers
    const codeInput = screen
      .getByTestId(`gauntlet-run-select-${code.id}`)
      .querySelector("input") as HTMLInputElement
    const securityInput = screen
      .getByTestId(`gauntlet-run-select-${security.id}`)
      .querySelector("input") as HTMLInputElement
    expect(codeInput.checked).toBe(true)
    expect(securityInput.checked).toBe(false)
  })

  it("runs with the selected reviewers and max iterations", () => {
    seed()
    const onRun = vi.fn()
    render(<GauntletRunDialog {...defaultProps} onRun={onRun} />)

    fireEvent.change(screen.getByTestId("gauntlet-run-max-iterations"), {
      target: { value: "5" },
    })
    fireEvent.click(screen.getByTestId("gauntlet-run-start-button"))

    const [code] = gauntletStore.reviewers
    expect(onRun).toHaveBeenCalledWith(
      [expect.objectContaining({ id: code.id, name: "Code Review" })],
      5
    )
  })

  it("disables Run when nothing is selected", () => {
    seed()
    render(<GauntletRunDialog {...defaultProps} />)
    const [code] = gauntletStore.reviewers
    const codeInput = screen
      .getByTestId(`gauntlet-run-select-${code.id}`)
      .querySelector("input") as HTMLInputElement
    fireEvent.click(codeInput)
    expect(screen.getByTestId("gauntlet-run-start-button")).toBeDisabled()
  })
})
