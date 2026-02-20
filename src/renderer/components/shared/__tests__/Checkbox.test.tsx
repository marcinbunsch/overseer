/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createRef } from "react"
import { Checkbox } from "../Checkbox"

describe("Checkbox", () => {
  it("renders a checkbox input element", () => {
    render(<Checkbox data-testid="test-checkbox" />)
    const checkbox = screen.getByTestId("test-checkbox")

    expect(checkbox).toBeInTheDocument()
    expect(checkbox).toHaveAttribute("type", "checkbox")
  })

  it("always renders with type=checkbox regardless of props", () => {
    // TypeScript prevents passing type prop, but runtime should enforce checkbox
    render(<Checkbox data-testid="test-checkbox" />)
    expect(screen.getByTestId("test-checkbox")).toHaveAttribute("type", "checkbox")
  })

  it("applies ovr-checkbox class by default", () => {
    render(<Checkbox data-testid="test-checkbox" />)
    const checkbox = screen.getByTestId("test-checkbox")

    expect(checkbox).toHaveClass("ovr-checkbox")
  })

  it("merges custom className with default", () => {
    render(<Checkbox data-testid="test-checkbox" className="custom-class size-6" />)
    const checkbox = screen.getByTestId("test-checkbox")

    expect(checkbox).toHaveClass("ovr-checkbox")
    expect(checkbox).toHaveClass("custom-class")
    expect(checkbox).toHaveClass("size-6")
  })

  it("forwards ref to the checkbox element", () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox ref={ref} data-testid="test-checkbox" />)

    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current).toBe(screen.getByTestId("test-checkbox"))
  })

  it("forwards onChange handler", () => {
    const handleChange = vi.fn()
    render(<Checkbox data-testid="test-checkbox" onChange={handleChange} />)

    fireEvent.click(screen.getByTestId("test-checkbox"))
    expect(handleChange).toHaveBeenCalled()
  })

  it("forwards checked prop", () => {
    render(<Checkbox data-testid="test-checkbox" checked readOnly />)
    expect(screen.getByTestId("test-checkbox")).toBeChecked()
  })

  it("forwards defaultChecked prop", () => {
    render(<Checkbox data-testid="test-checkbox" defaultChecked />)
    expect(screen.getByTestId("test-checkbox")).toBeChecked()
  })

  it("forwards disabled prop", () => {
    render(<Checkbox data-testid="test-checkbox" disabled />)
    expect(screen.getByTestId("test-checkbox")).toBeDisabled()
  })
})
