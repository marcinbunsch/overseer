/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CodexUsageIndicator } from "../CodexUsageIndicator"
import { codexUsageStore } from "../../../stores/CodexUsageStore"

describe("CodexUsageIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    codexUsageStore.usageData = null
  })

  it("renders nothing without rate-limit data", () => {
    const { container } = render(<CodexUsageIndicator />)

    expect(container.firstChild).toBeNull()
  })

  it("renders rate-limit windows, plan, and credits", () => {
    codexUsageStore.setUsageData({
      limitId: "codex",
      limitName: "Codex",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: 1_800_100_000 },
      credits: { hasCredits: true, unlimited: false, balance: "$12.34" },
      planType: "pro",
    })

    render(<CodexUsageIndicator />)

    expect(screen.getByTestId("codex-usage-indicator")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-primary-5-hour-limit")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-secondary-168-hour-limit")).toBeInTheDocument()
    expect(screen.getByTestId("codex-usage-account-details")).toHaveTextContent(
      "Pro · Credits: $12.34"
    )
  })

  it("renders unlimited credits without a balance", () => {
    codexUsageStore.setUsageData({
      limitId: "codex",
      limitName: "Codex",
      primary: null,
      secondary: null,
      credits: { hasCredits: true, unlimited: true, balance: null },
      planType: "self_serve_business_usage_based",
    })

    render(<CodexUsageIndicator />)

    expect(screen.getByTestId("codex-usage-account-details")).toHaveTextContent(
      "Self Serve Business Usage Based · Unlimited credits"
    )
  })
})
