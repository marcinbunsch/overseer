/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AutonomousDialog } from "../AutonomousDialog"

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

    expect(onStart).toHaveBeenCalledWith("Test prompt", 25)
  })

  it("calls onStart with custom maxIterations", () => {
    const onStart = vi.fn()
    render(<AutonomousDialog {...defaultProps} onStart={onStart} />)

    const input = screen.getByTestId("autonomous-max-iterations-input")
    fireEvent.change(input, { target: { value: "10" } })
    fireEvent.click(screen.getByTestId("autonomous-start-button"))

    expect(onStart).toHaveBeenCalledWith("Test prompt", 10)
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
})
