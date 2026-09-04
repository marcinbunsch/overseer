/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { ErrorBoundary } from "./ErrorBoundary"

function Boom(): React.ReactElement {
  throw new Error("kaboom on render")
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">hello</div>
      </ErrorBoundary>
    )
    expect(screen.getByTestId("child")).toBeTruthy()
    expect(screen.queryByTestId("error-boundary-fallback")).toBeNull()
  })

  it("shows the fallback with the error message when a child throws", () => {
    // React logs the caught error; silence it to keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByTestId("error-boundary-fallback")).toBeTruthy()
    expect(screen.getByTestId("error-boundary-message").textContent).toContain("kaboom on render")
  })
})
