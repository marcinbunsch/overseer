/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { ClaudeUsageIndicator } from "../ClaudeUsageIndicator"
import { UsageCircleIndicator } from "../UsageCircleIndicator"
import { claudeUsageStore } from "../../../stores/ClaudeUsageStore"
import { configStore } from "../../../stores/ConfigStore"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock the stores
vi.mock("../../../stores/ClaudeUsageStore", () => ({
  claudeUsageStore: {
    getUsageData: vi.fn(() => null),
    fetchUsage: vi.fn(),
  },
}))

vi.mock("../../../stores/ConfigStore", () => ({
  configStore: {
    showClaudeUsageIndicator: false,
  },
}))

// Helper: make the mocked store return this usage for any config dir.
function stubUsage(usageData: unknown) {
  vi.mocked(claudeUsageStore.getUsageData).mockReturnValue(usageData as never)
}

describe("ClaudeUsageIndicator", () => {
  beforeEach(() => {
    vi.mocked(configStore).showClaudeUsageIndicator = false
    vi.mocked(claudeUsageStore.getUsageData).mockReturnValue(null)
    vi.mocked(claudeUsageStore.fetchUsage).mockClear()
    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const fiveHourOnly = (utilization: number) => ({
    fiveHour: { utilization, resetsAt: "2026-02-17T12:00:00Z" },
    sevenDay: null,
    sevenDayOauthApps: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    sevenDayCowork: null,
    iguanaNecktie: null,
    extraUsage: null,
  })

  it("renders nothing when setting is disabled", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = false
    stubUsage(fiveHourOnly(50.0))

    const { container } = render(<ClaudeUsageIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when usageData is null even if setting is enabled", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(null)

    const { container } = render(<ClaudeUsageIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it("renders circles when setting is enabled and usage data is available", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage({
      fiveHour: { utilization: 50.0, resetsAt: "2026-02-17T12:00:00Z" },
      sevenDay: { utilization: 30.0, resetsAt: "2026-02-18T12:00:00Z" },
      sevenDayOauthApps: null,
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayCowork: null,
      iguanaNecktie: null,
      extraUsage: null,
    })

    render(<ClaudeUsageIndicator />)

    expect(screen.getByTestId("claude-usage-indicator")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-5-hour-limit")).toBeInTheDocument()
    expect(screen.getByTestId("usage-indicator-7-day-limit")).toBeInTheDocument()
  })

  it("reads and fetches usage for the passed config dir", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(fiveHourOnly(50.0))

    render(<ClaudeUsageIndicator claudeConfigDir="~/.claude-work" />)

    expect(claudeUsageStore.getUsageData).toHaveBeenCalledWith("~/.claude-work")
    expect(claudeUsageStore.fetchUsage).toHaveBeenCalledWith("~/.claude-work")
  })

  it("renders only five_hour circle when seven_day is null", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(fiveHourOnly(50.0))

    render(<ClaudeUsageIndicator />)

    expect(screen.getByTestId("usage-indicator-5-hour-limit")).toBeInTheDocument()
    expect(screen.queryByTestId("usage-indicator-7-day-limit")).not.toBeInTheDocument()
  })

  it("applies green color for utilization < 70%", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(fiveHourOnly(50.0))

    render(<ClaudeUsageIndicator />)

    const svg = screen.getByTestId("usage-indicator-5-hour-limit")
    const progressCircle = svg.querySelector("circle:last-child")
    expect(progressCircle).toHaveAttribute("stroke", "#2de2a6") // ovr-ok green
  })

  it("applies yellow color for utilization >= 70% and < 90%", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(fiveHourOnly(75.0))

    render(<ClaudeUsageIndicator />)

    const svg = screen.getByTestId("usage-indicator-5-hour-limit")
    const progressCircle = svg.querySelector("circle:last-child")
    expect(progressCircle).toHaveAttribute("stroke", "#ffee00") // ovr-warn yellow
  })

  it("applies red color for utilization >= 90%", () => {
    vi.mocked(configStore).showClaudeUsageIndicator = true
    stubUsage(fiveHourOnly(95.0))

    render(<ClaudeUsageIndicator />)

    const svg = screen.getByTestId("usage-indicator-5-hour-limit")
    const progressCircle = svg.querySelector("circle:last-child")
    expect(progressCircle).toHaveAttribute("stroke", "#ff4d6d") // ovr-bad red
  })

  it("shows zero minutes when the reset time has passed", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-17T12:00:00Z"))

    render(
      <UsageCircleIndicator
        utilization={50}
        label="Expired Limit"
        resetsAt="2026-02-17T11:59:00Z"
      />
    )

    fireEvent.pointerMove(screen.getByTestId("usage-indicator-expired-limit"))
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(screen.getByTestId("usage-indicator-tooltip-expired-limit")).toHaveTextContent(
      "Resets in 0m"
    )
  })
})
