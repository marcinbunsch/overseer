/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { toolAvailabilityStore } from "../../../stores/ToolAvailabilityStore"
import { configStore } from "../../../stores/ConfigStore"
import { SettingsDialog } from "../SettingsDialog"

describe("SettingsDialog path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toolAvailabilityStore.claude = null
    toolAvailabilityStore.codex = null
  })

  it("shows checkmark when Claude is available", () => {
    toolAvailabilityStore.claude = {
      available: true,
      version: "claude 1.0.0",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    // Check icon should be present
    expect(screen.getByTitle("claude 1.0.0")).toBeInTheDocument()
  })

  it("shows warning when Claude is not available", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "command not found",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByTitle("command not found")).toBeInTheDocument()
  })

  it("shows checkmark when Codex is available", () => {
    toolAvailabilityStore.codex = {
      available: true,
      version: "codex 2.0.0",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByTitle("codex 2.0.0")).toBeInTheDocument()
  })

  it("clicking Check button triggers recheck for Claude", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "claude 1.2.3",
    })

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    const checkButton = screen.getByTestId("check-claude-btn")
    fireEvent.click(checkButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_command_exists", {
        command: expect.any(String),
      })
    })
  })

  it("clicking Check button triggers recheck for Codex", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "codex 1.0.0",
    })

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    const checkButton = screen.getByTestId("check-codex-btn")
    fireEvent.click(checkButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_command_exists", {
        command: expect.any(String),
      })
    })
  })

  it("displays CLI paths in agent sections", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    // CLI Path label should appear in each agent section
    const cliPathLabels = screen.getAllByText("CLI Path:")
    // Should have at least 2 (Claude and Codex are enabled by default)
    expect(cliPathLabels.length).toBeGreaterThanOrEqual(2)
  })
})

describe("SettingsDialog default models", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset configStore default models
    configStore.defaultClaudeModel = null
    configStore.defaultCodexModel = null
    configStore.defaultCopilotModel = null
  })

  it("displays agent sections with model selectors", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    // Default Model label should appear in each agent section
    const defaultModelLabels = screen.getAllByText("Default Model:")
    expect(defaultModelLabels.length).toBeGreaterThanOrEqual(2)
  })

  it("shows model selectors for each agent type", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    // All model selectors should be rendered, each showing "Default"
    const defaultButtons = screen.getAllByText("Default")
    // Should have at least 2 (one per enabled agent)
    expect(defaultButtons.length).toBeGreaterThanOrEqual(2)
  })

  it("displays selected model name when set", () => {
    configStore.defaultClaudeModel = "claude-opus-4-6"
    configStore.defaultCodexModel = "gpt-5.3-codex"
    configStore.defaultCopilotModel = "claude-sonnet-4.5"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByText("Opus 4.6")).toBeInTheDocument()
    expect(screen.getByText("GPT-5.3 Codex")).toBeInTheDocument()
    expect(screen.getByText("Claude Sonnet 4.5")).toBeInTheDocument()
  })
})

describe("SettingsDialog Claude permission mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("displays permission mode selector in Claude section", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByText("Permission Mode:")).toBeInTheDocument()
  })

  it("shows current permission mode value", () => {
    configStore.claudePermissionMode = "acceptEdits"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByText("Accept Edits")).toBeInTheDocument()
  })
})
