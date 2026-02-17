/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ClaudeUsageIndicator } from "../ClaudeUsageIndicator"
import { claudeUsageStore } from "../../../stores/ClaudeUsageStore"

// Mock the store
vi.mock("../../../stores/ClaudeUsageStore", () => ({
  claudeUsageStore: {
    usageData: null,
  },
}))

describe("ClaudeUsageIndicator", () => {
  it("renders nothing when usageData is null", () => {
    const { container } = render(<ClaudeUsageIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it("renders circles when usage data is available", () => {
    vi.mocked(claudeUsageStore).usageData = {
      fiveHour: { utilization: 50.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: { utilization: 30.0, resetsAt: "2026-02-18T12:00:00Z" },
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    }

    render(<ClaudeUsageIndicator />)

    expect(screen.getByTestId("claude-usage-indicator")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-5-hour-limit")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-7-day-limit")).toBeInTheDocument()
  })

  it("renders only five_hour circle when seven_day is null", () => {
    vi.mocked(claudeUsageStore).usageData = {
      fiveHour: { utilization: 50.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: null,
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    }

    render(<ClaudeUsageIndicator />)

    expect(screen.getByTestId("usage-indicator-5-hour-limit")).toBeInTheDocument()
    expect(screen.queryByTestId("usage-indicator-7-day-limit")).not.toBeInTheDocument()
  })

  it("applies green color for utilization < 70%", () => {
    vi.mocked(claudeUsageStore).usageData = {
      fiveHour: { utilization: 50.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: null,
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    }

    render(<ClaudeUsageIndicator />)

    const circle = screen.getByTestId("usage-indicator-5-hour-limit")
    expect(circle).toHaveClass("bg-green-500")
  })

  it("applies yellow color for utilization >= 70% and < 90%", () => {
    vi.mocked(claudeUsageStore).usageData = {
      fiveHour: { utilization: 75.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: null,
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    }

    render(<ClaudeUsageIndicator />)

    const circle = screen.getByTestId("usage-indicator-5-hour-limit")
    expect(circle).toHaveClass("bg-yellow-500")
  })

  it("applies red color for utilization >= 90%", () => {
    vi.mocked(claudeUsageStore).usageData = {
      fiveHour: { utilization: 95.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: null,
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    }

    render(<ClaudeUsageIndicator />)

    const circle = screen.getByTestId("usage-indicator-5-hour-limit")
    expect(circle).toHaveClass("bg-red-500")
  })
})
