/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createRef } from "react"
import { Input } from "../Input"

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input data-testid="test-input" />)
    expect(screen.getByTestId("test-input")).toBeInTheDocument()
  })

  it("sets autocomplete attributes to off by default", () => {
    render(<Input data-testid="test-input" />)
    const input = screen.getByTestId("test-input")

    expect(input).toHaveAttribute("autocomplete", "off")
    expect(input).toHaveAttribute("autocorrect", "off")
    expect(input).toHaveAttribute("autocapitalize", "off")
    expect(input).toHaveAttribute("spellcheck", "false")
  })

  it("applies ovr-input class by default", () => {
    render(<Input data-testid="test-input" />)
    const input = screen.getByTestId("test-input")

    expect(input).toHaveClass("ovr-input")
  })

  it("merges custom className with default", () => {
    render(<Input data-testid="test-input" className="custom-class text-xs" />)
    const input = screen.getByTestId("test-input")

    expect(input).toHaveClass("ovr-input")
    expect(input).toHaveClass("custom-class")
    expect(input).toHaveClass("text-xs")
  })

  it("forwards ref to the input element", () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} data-testid="test-input" />)

    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current).toBe(screen.getByTestId("test-input"))
  })

  it("forwards onChange handler", () => {
    const handleChange = vi.fn()
    render(<Input data-testid="test-input" onChange={handleChange} />)

    fireEvent.change(screen.getByTestId("test-input"), { target: { value: "test" } })
    expect(handleChange).toHaveBeenCalled()
  })

  it("forwards placeholder prop", () => {
    render(<Input data-testid="test-input" placeholder="Enter text..." />)
    expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument()
  })

  it("forwards value prop", () => {
    render(<Input data-testid="test-input" value="initial value" readOnly />)
    expect(screen.getByTestId("test-input")).toHaveValue("initial value")
  })

  it("forwards type prop", () => {
    render(<Input data-testid="test-input" type="password" />)
    expect(screen.getByTestId("test-input")).toHaveAttribute("type", "password")
  })
})
