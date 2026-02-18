/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createRef } from "react"
import { Textarea } from "../Textarea"

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea data-testid="test-textarea" />)
    expect(screen.getByTestId("test-textarea")).toBeInTheDocument()
  })

  it("sets autocomplete attributes to off by default", () => {
    render(<Textarea data-testid="test-textarea" />)
    const textarea = screen.getByTestId("test-textarea")

    expect(textarea).toHaveAttribute("autocomplete", "off")
    expect(textarea).toHaveAttribute("autocorrect", "off")
    expect(textarea).toHaveAttribute("autocapitalize", "off")
    expect(textarea).toHaveAttribute("spellcheck", "false")
  })

  it("applies ovr-textarea class by default", () => {
    render(<Textarea data-testid="test-textarea" />)
    const textarea = screen.getByTestId("test-textarea")

    expect(textarea).toHaveClass("ovr-textarea")
  })

  it("merges custom className with default", () => {
    render(<Textarea data-testid="test-textarea" className="custom-class text-sm" />)
    const textarea = screen.getByTestId("test-textarea")

    expect(textarea).toHaveClass("ovr-textarea")
    expect(textarea).toHaveClass("custom-class")
    expect(textarea).toHaveClass("text-sm")
  })

  it("forwards ref to the textarea element", () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} data-testid="test-textarea" />)

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
    expect(ref.current).toBe(screen.getByTestId("test-textarea"))
  })

  it("forwards onChange handler", () => {
    const handleChange = vi.fn()
    render(<Textarea data-testid="test-textarea" onChange={handleChange} />)

    fireEvent.change(screen.getByTestId("test-textarea"), { target: { value: "test" } })
    expect(handleChange).toHaveBeenCalled()
  })

  it("forwards placeholder prop", () => {
    render(<Textarea data-testid="test-textarea" placeholder="Enter text..." />)
    expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument()
  })

  it("forwards value prop", () => {
    render(<Textarea data-testid="test-textarea" value="initial value" readOnly />)
    expect(screen.getByTestId("test-textarea")).toHaveValue("initial value")
  })

  it("forwards rows prop", () => {
    render(<Textarea data-testid="test-textarea" rows={5} />)
    expect(screen.getByTestId("test-textarea")).toHaveAttribute("rows", "5")
  })
})
