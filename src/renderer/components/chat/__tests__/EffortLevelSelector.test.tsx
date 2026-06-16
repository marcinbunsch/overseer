/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EffortLevelSelector } from "../EffortLevelSelector"

describe("EffortLevelSelector", () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with 'Default' when value is null", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} />)

    expect(screen.getByTestId("effort-level-selector")).toHaveTextContent("Default")
  })

  it("renders with 'Low' when value is 'low'", () => {
    render(<EffortLevelSelector value="low" onChange={mockOnChange} />)

    expect(screen.getByTestId("effort-level-selector")).toHaveTextContent("Low")
  })

  it("renders with 'Medium' when value is 'medium'", () => {
    render(<EffortLevelSelector value="medium" onChange={mockOnChange} />)

    expect(screen.getByTestId("effort-level-selector")).toHaveTextContent("Medium")
  })

  it("renders with 'High' when value is 'high'", () => {
    render(<EffortLevelSelector value="high" onChange={mockOnChange} />)

    expect(screen.getByTestId("effort-level-selector")).toHaveTextContent("High")
  })

  it("renders with 'Max' when value is 'max'", () => {
    render(<EffortLevelSelector value="max" onChange={mockOnChange} />)

    expect(screen.getByTestId("effort-level-selector")).toHaveTextContent("Max")
  })

  it("shows all dropdown options when clicked", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))

    expect(screen.getByTestId("effort-level-dropdown")).toBeInTheDocument()
    expect(screen.getByTestId("effort-level-option-default")).toHaveTextContent("Default")
    expect(screen.getByTestId("effort-level-option-low")).toHaveTextContent("Low")
    expect(screen.getByTestId("effort-level-option-medium")).toHaveTextContent("Medium")
    expect(screen.getByTestId("effort-level-option-high")).toHaveTextContent("High")
    expect(screen.getByTestId("effort-level-option-max")).toHaveTextContent("Max")
  })

  it("calls onChange with null when Default option is selected", () => {
    render(<EffortLevelSelector value="high" onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))
    fireEvent.click(screen.getByTestId("effort-level-option-default"))

    expect(mockOnChange).toHaveBeenCalledWith(null)
  })

  it("calls onChange with 'low' when Low option is selected", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))
    fireEvent.click(screen.getByTestId("effort-level-option-low"))

    expect(mockOnChange).toHaveBeenCalledWith("low")
  })

  it("calls onChange with 'max' when Max option is selected", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))
    fireEvent.click(screen.getByTestId("effort-level-option-max"))

    expect(mockOnChange).toHaveBeenCalledWith("max")
  })

  it("is disabled when disabled prop is true", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} disabled />)

    const button = screen.getByTestId("effort-level-selector")
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(screen.queryByTestId("effort-level-dropdown")).not.toBeInTheDocument()
  })

  it("highlights currently selected level with azure color", () => {
    render(<EffortLevelSelector value="high" onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))

    const selectedOption = screen.getByTestId("effort-level-option-high")
    expect(selectedOption).toHaveClass("text-ovr-azure-400")

    const unselectedOption = screen.getByTestId("effort-level-option-default")
    expect(unselectedOption).toHaveClass("text-ovr-text-primary")
  })

  it("closes dropdown when option is selected", () => {
    render(<EffortLevelSelector value={null} onChange={mockOnChange} />)

    fireEvent.click(screen.getByTestId("effort-level-selector"))
    expect(screen.getByTestId("effort-level-dropdown")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("effort-level-option-high"))
    expect(screen.queryByTestId("effort-level-dropdown")).not.toBeInTheDocument()
  })

  it("closes dropdown when clicking outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <EffortLevelSelector value={null} onChange={mockOnChange} />
      </div>
    )

    fireEvent.click(screen.getByTestId("effort-level-selector"))
    expect(screen.getByTestId("effort-level-dropdown")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByTestId("effort-level-dropdown")).not.toBeInTheDocument()
  })
})
