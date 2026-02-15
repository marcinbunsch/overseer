/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { toolAvailabilityStore } from "../../../stores/ToolAvailabilityStore"
import { configStore } from "../../../stores/ConfigStore"
import { SettingsDialog } from "../SettingsDialog"

// Helper to navigate to a tab
function goToTab(tabName: "general" | "agents" | "advanced" | "updates") {
  fireEvent.click(screen.getByTestId(`tab-${tabName}`))
}

describe("SettingsDialog tab navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with General tab active by default", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    // General tab should be selected (has different styling, but we can check content)
    expect(screen.getByText("Default agent")).toBeInTheDocument()
    expect(screen.getByText("Appearance")).toBeInTheDocument()
  })

  it("switches to Agents tab when clicked", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    goToTab("agents")

    expect(screen.getByText("Enabled agents")).toBeInTheDocument()
    expect(screen.getByText("Agent settings")).toBeInTheDocument()
  })

  it("switches to Advanced tab when clicked", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    goToTab("advanced")

    expect(screen.getByText("Shell Prefix")).toBeInTheDocument()
    expect(screen.getByTestId("agent-shell-input")).toBeInTheDocument()
  })

  it("switches to Updates tab when clicked", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    goToTab("updates")

    expect(screen.getByText(/Current version:/)).toBeInTheDocument()
    expect(screen.getByTestId("check-updates-btn")).toBeInTheDocument()
  })

  it("shows all tab buttons in sidebar", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByTestId("tab-general")).toBeInTheDocument()
    expect(screen.getByTestId("tab-agents")).toBeInTheDocument()
    expect(screen.getByTestId("tab-advanced")).toBeInTheDocument()
    expect(screen.getByTestId("tab-updates")).toBeInTheDocument()
  })
})

describe("SettingsDialog General tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configStore.animationsEnabled = true
  })

  it("shows animations toggle", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByText("Animations")).toBeInTheDocument()
    expect(screen.getByTestId("animations-toggle")).toBeInTheDocument()
  })

  it("toggles animations setting when clicked", () => {
    const setAnimationsSpy = vi.spyOn(configStore, "setAnimationsEnabled")

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    const toggle = screen.getByTestId("animations-toggle")
    fireEvent.click(toggle)

    expect(setAnimationsSpy).toHaveBeenCalledWith(false)
  })

  it("shows default agent selector", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)

    expect(screen.getByText("Default agent")).toBeInTheDocument()
    expect(screen.getByTestId("default-agent-trigger")).toBeInTheDocument()
  })
})

describe("SettingsDialog Agents tab - path validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toolAvailabilityStore.claude = null
    toolAvailabilityStore.codex = null
    // Ensure Claude and Codex are enabled
    configStore.setAgentEnabled("claude", true)
    configStore.setAgentEnabled("codex", true)
  })

  it("shows checkmark when Claude is available", () => {
    toolAvailabilityStore.claude = {
      available: true,
      version: "claude 1.0.0",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByTitle("claude 1.0.0")).toBeInTheDocument()
  })

  it("shows warning when Claude is not available", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "command not found",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByTitle("command not found")).toBeInTheDocument()
  })

  it("shows checkmark when Codex is available", () => {
    toolAvailabilityStore.codex = {
      available: true,
      version: "codex 2.0.0",
      lastChecked: Date.now(),
    }

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByTitle("codex 2.0.0")).toBeInTheDocument()
  })

  it("clicking Check button triggers recheck for Claude", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "claude 1.2.3",
    })

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

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
    goToTab("agents")

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
    goToTab("agents")

    // CLI Path label should appear in each agent section
    const cliPathLabels = screen.getAllByText("CLI Path:")
    // Should have at least 2 (Claude and Codex are enabled by default)
    expect(cliPathLabels.length).toBeGreaterThanOrEqual(2)
  })
})

describe("SettingsDialog Agents tab - enabled toggles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset agent enabled states to ensure test isolation
    configStore.setAgentEnabled("claude", true)
    configStore.setAgentEnabled("codex", true)
  })

  it("shows toggle for each agent", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByTestId("agent-toggle-claude")).toBeInTheDocument()
    expect(screen.getByTestId("agent-toggle-codex")).toBeInTheDocument()
    expect(screen.getByTestId("agent-toggle-copilot")).toBeInTheDocument()
    expect(screen.getByTestId("agent-toggle-gemini")).toBeInTheDocument()
    expect(screen.getByTestId("agent-toggle-opencode")).toBeInTheDocument()
  })

  it("calls setAgentEnabled when toggling agent", () => {
    const setAgentEnabledSpy = vi.spyOn(configStore, "setAgentEnabled")

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    // Toggle Claude off (it's enabled by default)
    const claudeToggle = screen.getByTestId("agent-toggle-claude")
    fireEvent.click(claudeToggle)

    expect(setAgentEnabledSpy).toHaveBeenCalledWith("claude", false)
  })
})

describe("SettingsDialog Agents tab - default models", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset default models
    configStore.defaultClaudeModel = null
    configStore.defaultCodexModel = null
    configStore.defaultCopilotModel = null
    // Ensure Claude and Codex are enabled (they may have been disabled by previous tests)
    configStore.setAgentEnabled("claude", true)
    configStore.setAgentEnabled("codex", true)
  })

  it("displays agent sections with model selectors", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    // Default Model label should appear in each agent section
    const defaultModelLabels = screen.getAllByText("Default Model:")
    expect(defaultModelLabels.length).toBeGreaterThanOrEqual(2)
  })

  it("shows model selectors for each agent type", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    // All model selectors should be rendered, each showing "Default"
    const defaultButtons = screen.getAllByText("Default")
    // Should have at least 2 (one per enabled agent)
    expect(defaultButtons.length).toBeGreaterThanOrEqual(2)
  })

  it("displays selected model name when set for Claude", () => {
    configStore.defaultClaudeModel = "claude-opus-4-6"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByText("Opus 4.6")).toBeInTheDocument()
  })

  it("displays selected model name when set for Codex", () => {
    configStore.defaultCodexModel = "gpt-5.3-codex"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByText("GPT-5.3 Codex")).toBeInTheDocument()
  })

  it("displays selected model name when set for Copilot", () => {
    // Copilot is disabled by default, so we need to enable it
    configStore.setAgentEnabled("copilot", true)
    configStore.defaultCopilotModel = "claude-sonnet-4.5"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByText("Claude Sonnet 4.5")).toBeInTheDocument()
  })
})

describe("SettingsDialog Agents tab - Claude permission mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure Claude is enabled
    configStore.setAgentEnabled("claude", true)
  })

  it("displays permission mode selector in Claude section", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByText("Permission Mode:")).toBeInTheDocument()
  })

  it("shows current permission mode value", () => {
    configStore.claudePermissionMode = "acceptEdits"

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("agents")

    expect(screen.getByText("Accept Edits")).toBeInTheDocument()
  })
})

describe("SettingsDialog Advanced tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configStore.agentShell = ""
  })

  it("shows shell prefix input", () => {
    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("advanced")

    expect(screen.getByTestId("agent-shell-input")).toBeInTheDocument()
  })

  it("calls setAgentShell when input changes", () => {
    const setAgentShellSpy = vi.spyOn(configStore, "setAgentShell")

    render(<SettingsDialog open={true} onOpenChange={() => {}} />)
    goToTab("advanced")

    const input = screen.getByTestId("agent-shell-input")
    fireEvent.change(input, { target: { value: "/bin/zsh -c" } })

    expect(setAgentShellSpy).toHaveBeenCalledWith("/bin/zsh -c")
  })
})
