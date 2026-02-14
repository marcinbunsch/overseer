/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ClaudePermissionModeSelector } from "../ClaudePermissionModeSelector"

describe("ClaudePermissionModeSelector", () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with 'Default' when value is null", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} />)

    expect(screen.getByTestId("permission-mode-selector")).toHaveTextContent("Default")
  })

  it("renders with 'Accept Edits' when value is 'acceptEdits'", () => {
    render(<ClaudePermissionModeSelector value="acceptEdits" onChange={mockOnChange} />)

    expect(screen.getByTestId("permission-mode-selector")).toHaveTextContent("Accept Edits")
  })

  it("renders with 'Yolo Mode' when value is 'bypassPermissions'", () => {
    render(<ClaudePermissionModeSelector value="bypassPermissions" onChange={mockOnChange} />)

    expect(screen.getByTestId("permission-mode-selector")).toHaveTextContent("Yolo Mode")
  })

  it("shows dropdown options when clicked", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} />)

    const button = screen.getByTestId("permission-mode-selector")
    fireEvent.click(button)

    expect(screen.getByTestId("permission-mode-dropdown")).toBeInTheDocument()
    expect(screen.getByTestId("permission-mode-option-default")).toHaveTextContent("Default")
    expect(screen.getByTestId("permission-mode-option-acceptEdits")).toHaveTextContent(
      "Accept Edits"
    )
    expect(screen.getByTestId("permission-mode-option-bypassPermissions")).toHaveTextContent(
      "Yolo Mode"
    )
  })

  it("calls onChange with null when Default option is selected", () => {
    render(<ClaudePermissionModeSelector value="acceptEdits" onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("permission-mode-selector"))
    fireEvent.click(screen.getByTestId("permission-mode-option-default"))

    expect(mockOnChange).toHaveBeenCalledWith(null)
  })

  it("calls onChange with 'acceptEdits' when Accept Edits option is selected", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("permission-mode-selector"))
    fireEvent.click(screen.getByTestId("permission-mode-option-acceptEdits"))

    expect(mockOnChange).toHaveBeenCalledWith("acceptEdits")
  })

  it("calls onChange with 'bypassPermissions' when Yolo Mode option is selected", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("permission-mode-selector"))
    fireEvent.click(screen.getByTestId("permission-mode-option-bypassPermissions"))

    expect(mockOnChange).toHaveBeenCalledWith("bypassPermissions")
  })

  it("is disabled when disabled prop is true", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} disabled />)

    const button = screen.getByTestId("permission-mode-selector")
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(screen.queryByTestId("permission-mode-dropdown")).not.toBeInTheDocument()
  })

  it("highlights currently selected mode with azure color", () => {
    render(<ClaudePermissionModeSelector value="acceptEdits" onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("permission-mode-selector"))

    const selectedOption = screen.getByTestId("permission-mode-option-acceptEdits")
    expect(selectedOption).toHaveClass("text-ovr-azure-400")

    const unselectedOption = screen.getByTestId("permission-mode-option-default")
    expect(unselectedOption).toHaveClass("text-ovr-text-primary")
  })

  it("closes dropdown when option is selected", () => {
    render(<ClaudePermissionModeSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("permission-mode-selector"))
    expect(screen.getByTestId("permission-mode-dropdown")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("permission-mode-option-acceptEdits"))
    expect(screen.queryByTestId("permission-mode-dropdown")).not.toBeInTheDocument()
  })

  it("closes dropdown when clicking outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ClaudePermissionModeSelector value={null} onChange={mockOnChange} />
      </div>
    )

    fireEvent.click(screen.getByTestId("permission-mode-selector"))
    expect(screen.getByTestId("permission-mode-dropdown")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByTestId("permission-mode-dropdown")).not.toBeInTheDocument()
  })
})
