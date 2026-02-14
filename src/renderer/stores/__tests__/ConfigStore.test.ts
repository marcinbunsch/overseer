import { describe, it, expect, vi, beforeEach } from "vitest"
import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

// We need to test ConfigStore's class logic without triggering the singleton's
// constructor side effects. Import the module fresh each test.
describe("ConfigStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(homeDir).mockResolvedValue("/home/testuser/")
  })

  it("loads config from disk and expands $HOME", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "$HOME/.local/bin/claude",
        leftPaneWidth: 300,
        rightPaneWidth: 400,
        changesHeight: 200,
        editorCommand: "vim",
        terminalCommand: "xterm",
      })
    )

    // Import fresh to trigger constructor
    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    // Wait for async load to complete
    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.claudePath).toBe("/home/testuser/.local/bin/claude")
    expect(configStore.leftPaneWidth).toBe(300)
    expect(configStore.rightPaneWidth).toBe(400)
    expect(configStore.changesHeight).toBe(200)
    expect(configStore.editorCommand).toBe("vim")
    expect(configStore.terminalCommand).toBe("xterm")
  })

  it("creates default config when file does not exist", async () => {
    vi.mocked(exists).mockResolvedValueOnce(false) // config file
    vi.mocked(exists).mockResolvedValueOnce(false) // config dir
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "$HOME/.local/bin/claude",
        leftPaneWidth: 250,
        rightPaneWidth: 300,
        changesHeight: 250,
        editorCommand: "code",
        terminalCommand: "open -a iTerm",
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    // In test/dev mode, uses overseer-dev directory
    expect(mkdir).toHaveBeenCalledWith("/home/testuser/.config/overseer-dev", { recursive: true })
    expect(writeTextFile).toHaveBeenCalled()
  })

  it("falls back to bare 'claude' on load error", async () => {
    vi.mocked(homeDir).mockRejectedValue(new Error("no home"))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.claudePath).toBe("claude")
  })

  it("uses defaults for missing config fields", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "$HOME/bin/claude",
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.leftPaneWidth).toBe(250)
    expect(configStore.rightPaneWidth).toBe(300)
    expect(configStore.changesHeight).toBe(250)
    expect(configStore.editorCommand).toBe("code")
    expect(configStore.terminalCommand).toBe("open -a iTerm")
  })

  it("saves config when pane width is changed", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    vi.mocked(writeTextFile).mockClear()
    configStore.setLeftPaneWidth(500)

    expect(configStore.leftPaneWidth).toBe(500)
    // save is async, wait for it
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalled()
    })
  })

  it("strips trailing slash from home directory", async () => {
    vi.mocked(homeDir).mockResolvedValue("/home/testuser/")
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "$HOME/claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    // Should be /home/testuser/claude, not /home/testuser//claude
    expect(configStore.claudePath).toBe("/home/testuser/claude")
  })

  it("expands unknown env vars to empty string", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "$UNKNOWN_VAR/claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.claudePath).toBe("/claude")
  })

  it("uses default Claude models when not in config", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.claudeModels).toEqual([
      { alias: "claude-opus-4-6", displayName: "Opus 4.6" },
      { alias: "claude-opus-4-5", displayName: "Opus 4.5" },
      { alias: "claude-sonnet-4-5", displayName: "Sonnet 4.5" },
      { alias: "claude-haiku-4-5", displayName: "Haiku 4.5" },
    ])
  })

  it("uses default Codex models when not in config", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.codexModels).toEqual([
      { alias: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
      { alias: "gpt-5.2-codex", displayName: "GPT-5.2 Codex" },
      { alias: "gpt-5.1-codex-max", displayName: "GPT-5.1 Codex Max" },
      { alias: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini" },
    ])
  })

  it("loads custom model arrays from config", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    // Custom model arrays in config should be loaded
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "claude",
        claudeModels: [{ alias: "custom-claude", displayName: "Custom Claude" }],
        codexModels: [{ alias: "custom-codex", displayName: "Custom Codex" }],
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    // Models are loaded from config when specified
    expect(configStore.claudeModels).toEqual([
      { alias: "custom-claude", displayName: "Custom Claude" },
    ])
    expect(configStore.codexModels).toEqual([
      { alias: "custom-codex", displayName: "Custom Codex" },
    ])
  })

  it("loads default models for agents from config", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "claude",
        defaultClaudeModel: "opus",
        defaultCodexModel: "gpt-5.3-codex",
        defaultCopilotModel: "claude-sonnet-4-5",
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.defaultClaudeModel).toBe("opus")
    expect(configStore.defaultCodexModel).toBe("gpt-5.3-codex")
    expect(configStore.defaultCopilotModel).toBe("claude-sonnet-4-5")
  })

  it("defaults to null when default models are not in config", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.defaultClaudeModel).toBeNull()
    expect(configStore.defaultCodexModel).toBeNull()
    expect(configStore.defaultCopilotModel).toBeNull()
  })

  it("saves config when default Claude model is changed", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    vi.mocked(writeTextFile).mockClear()
    configStore.setDefaultClaudeModel("sonnet")

    expect(configStore.defaultClaudeModel).toBe("sonnet")
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalled()
    })

    const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
    expect(writtenConfig.defaultClaudeModel).toBe("sonnet")
  })

  it("saves config when default Codex model is changed", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    vi.mocked(writeTextFile).mockClear()
    configStore.setDefaultCodexModel("gpt-5.2-codex")

    expect(configStore.defaultCodexModel).toBe("gpt-5.2-codex")
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalled()
    })

    const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
    expect(writtenConfig.defaultCodexModel).toBe("gpt-5.2-codex")
  })

  it("saves config when default Copilot model is changed", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    vi.mocked(writeTextFile).mockClear()
    configStore.setDefaultCopilotModel("gpt-4o")

    expect(configStore.defaultCopilotModel).toBe("gpt-4o")
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalled()
    })

    const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
    expect(writtenConfig.defaultCopilotModel).toBe("gpt-4o")
  })

  it("getDefaultModelForAgent returns correct model for each agent type", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "claude",
        defaultClaudeModel: "opus",
        defaultCodexModel: "gpt-5.3-codex",
        defaultCopilotModel: "claude-sonnet-4-5",
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.getDefaultModelForAgent("claude")).toBe("opus")
    expect(configStore.getDefaultModelForAgent("codex")).toBe("gpt-5.3-codex")
    expect(configStore.getDefaultModelForAgent("copilot")).toBe("claude-sonnet-4-5")
  })

  it("allows setting default model to null", async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        claudePath: "claude",
        defaultClaudeModel: "opus",
      })
    )

    vi.resetModules()
    const { configStore } = await import("../ConfigStore")

    await vi.waitFor(() => {
      expect(configStore.loaded).toBe(true)
    })

    expect(configStore.defaultClaudeModel).toBe("opus")

    vi.mocked(writeTextFile).mockClear()
    configStore.setDefaultClaudeModel(null)

    expect(configStore.defaultClaudeModel).toBeNull()
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalled()
    })

    const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
    expect(writtenConfig.defaultClaudeModel).toBeNull()
  })

  describe("enabledAgents", () => {
    it("defaults to all agents enabled", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.enabledAgents).toEqual([
        "claude",
        "codex",
        "copilot",
        "gemini",
        "opencode",
      ])
      expect(configStore.isAgentEnabled("claude")).toBe(true)
      expect(configStore.isAgentEnabled("codex")).toBe(true)
    })

    it("loads enabledAgents from config", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          claudePath: "claude",
          enabledAgents: ["claude", "gemini"],
        })
      )

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.enabledAgents).toEqual(["claude", "gemini"])
      expect(configStore.isAgentEnabled("claude")).toBe(true)
      expect(configStore.isAgentEnabled("codex")).toBe(false)
      expect(configStore.isAgentEnabled("gemini")).toBe(true)
    })

    it("enables an agent", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          claudePath: "claude",
          enabledAgents: ["claude"],
        })
      )

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.isAgentEnabled("codex")).toBe(false)

      vi.mocked(writeTextFile).mockClear()
      configStore.setAgentEnabled("codex", true)

      expect(configStore.isAgentEnabled("codex")).toBe(true)
      expect(configStore.enabledAgents).toContain("codex")

      await vi.waitFor(() => {
        expect(writeTextFile).toHaveBeenCalled()
      })
    })

    it("disables an agent", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.isAgentEnabled("codex")).toBe(true)

      vi.mocked(writeTextFile).mockClear()
      configStore.setAgentEnabled("codex", false)

      expect(configStore.isAgentEnabled("codex")).toBe(false)
      expect(configStore.enabledAgents).not.toContain("codex")

      await vi.waitFor(() => {
        expect(writeTextFile).toHaveBeenCalled()
      })
    })

    it("clears defaultAgent when disabled agent was the default", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          claudePath: "claude",
          defaultAgent: "codex",
        })
      )

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.defaultAgent).toBe("codex")

      configStore.setAgentEnabled("codex", false)

      expect(configStore.defaultAgent).toBeNull()
    })

    it("does not duplicate agent when enabling already enabled agent", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      const initialLength = configStore.enabledAgents.length
      configStore.setAgentEnabled("claude", true)

      expect(configStore.enabledAgents.length).toBe(initialLength)
    })
  })

  describe("defaultAgent", () => {
    it("defaults to claude", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.defaultAgent).toBe("claude")
    })

    it("loads null defaultAgent from config", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({
          claudePath: "claude",
          defaultAgent: null,
        })
      )

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.defaultAgent).toBeNull()
    })

    it("sets defaultAgent to null", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      expect(configStore.defaultAgent).toBe("claude")

      vi.mocked(writeTextFile).mockClear()
      configStore.setDefaultAgent(null)

      expect(configStore.defaultAgent).toBeNull()

      await vi.waitFor(() => {
        expect(writeTextFile).toHaveBeenCalled()
      })

      const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
      expect(writtenConfig.defaultAgent).toBeNull()
    })

    it("sets defaultAgent to a specific agent", async () => {
      vi.mocked(exists).mockResolvedValue(true)
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ claudePath: "claude" }))

      vi.resetModules()
      const { configStore } = await import("../ConfigStore")

      await vi.waitFor(() => {
        expect(configStore.loaded).toBe(true)
      })

      vi.mocked(writeTextFile).mockClear()
      configStore.setDefaultAgent("gemini")

      expect(configStore.defaultAgent).toBe("gemini")

      await vi.waitFor(() => {
        expect(writeTextFile).toHaveBeenCalled()
      })

      const writtenConfig = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]![1] as string)
      expect(writtenConfig.defaultAgent).toBe("gemini")
    })
  })
})
