/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { RefreshProjectsButton } from "../RefreshProjectsButton"

const reloadWithState = vi.fn()
vi.mock("../../../utils/urlState", () => ({
  reloadWithState: () => reloadWithState(),
}))

describe("RefreshProjectsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders a labeled refresh button", () => {
    render(<RefreshProjectsButton />)
    expect(screen.getByLabelText("Refresh projects and workspaces")).toBeInTheDocument()
  })

  it("reloads with preserved state when clicked", () => {
    render(<RefreshProjectsButton />)
    screen.getByLabelText("Refresh projects and workspaces").click()
    expect(reloadWithState).toHaveBeenCalledTimes(1)
  })
})
