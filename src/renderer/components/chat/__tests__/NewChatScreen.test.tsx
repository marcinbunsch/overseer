/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { toolAvailabilityStore } from "../../../stores/ToolAvailabilityStore"
import { projectRegistry } from "../../../stores/ProjectRegistry"
import { configStore } from "../../../stores/ConfigStore"
import { NewChatScreen } from "../NewChatScreen"

// Create a mock workspace store
const mockWorkspaceStore = {
  newChat: vi.fn(),
  setActiveChatAgent: vi.fn(),
  hasArchivedChats: false,
}

vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspaceStore: null,
  },
}))

vi.mock("../../../stores/ConfigStore", () => ({
  configStore: {
    isAgentEnabled: vi.fn(() => true),
    enabledAgents: ["claude", "codex", "copilot", "gemini", "opencode"],
  },
}))

describe("NewChatScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toolAvailabilityStore.claude = null
    toolAvailabilityStore.codex = null
    toolAvailabilityStore.copilot = null
    toolAvailabilityStore.gemini = null
    toolAvailabilityStore.opencode = null
    vi.mocked(configStore.isAgentEnabled).mockReturnValue(true)
    // Reset mock functions
    mockWorkspaceStore.newChat = vi.fn()
    mockWorkspaceStore.setActiveChatAgent = vi.fn()
    mockWorkspaceStore.hasArchivedChats = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(projectRegistry as any).selectedWorkspaceStore = mockWorkspaceStore
  })

  it("renders the start new chat heading", () => {
    render(<NewChatScreen />)

    expect(screen.getByText("Start a new chat")).toBeInTheDocument()
    expect(screen.getByText("Choose an AI agent to get started")).toBeInTheDocument()
  })

  it("renders all three agent buttons", () => {
    render(<NewChatScreen />)

    expect(screen.getByText("Claude")).toBeInTheDocument()
    expect(screen.getByText("Anthropic's AI assistant")).toBeInTheDocument()

    expect(screen.getByText("Codex")).toBeInTheDocument()
    expect(screen.getByText("OpenAI's coding agent")).toBeInTheDocument()

    expect(screen.getByText("Copilot")).toBeInTheDocument()
    expect(screen.getByText("GitHub's AI pair programmer")).toBeInTheDocument()
  })

  it("calls newChat with claude when Claude button is clicked", () => {
    render(<NewChatScreen />)

    const claudeButton = screen.getByText("Claude").closest("button")!
    fireEvent.click(claudeButton)

    expect(mockWorkspaceStore.newChat).toHaveBeenCalledWith("claude")
  })

  it("calls newChat with codex when Codex button is clicked", () => {
    render(<NewChatScreen />)

    const codexButton = screen.getByText("Codex").closest("button")!
    fireEvent.click(codexButton)

    expect(mockWorkspaceStore.newChat).toHaveBeenCalledWith("codex")
  })

  it("calls newChat with copilot when Copilot button is clicked", () => {
    render(<NewChatScreen />)

    const copilotButton = screen.getByText("Copilot").closest("button")!
    fireEvent.click(copilotButton)

    expect(mockWorkspaceStore.newChat).toHaveBeenCalledWith("copilot")
  })

  it("shows warning indicator when agent is unavailable", () => {
    toolAvailabilityStore.claude = {
      available: false,
      error: "claude not found",
      lastChecked: Date.now(),
    }

    render(<NewChatScreen />)

    const claudeButton = screen.getByText("Claude").closest("button")!
    const warningIcon = claudeButton.querySelector('[title="claude not found"]')
    expect(warningIcon).toBeInTheDocument()
  })

  it("does not show warning when agent is available", () => {
    toolAvailabilityStore.claude = {
      available: true,
      version: "1.0.0",
      lastChecked: Date.now(),
    }

    render(<NewChatScreen />)

    const claudeButton = screen.getByText("Claude").closest("button")!
    const warningIcon = claudeButton.querySelector("[title]")
    expect(warningIcon).not.toBeInTheDocument()
  })

  describe("isPendingChat mode", () => {
    it("shows 'Select an agent' heading when isPendingChat is true", () => {
      render(<NewChatScreen isPendingChat />)

      expect(screen.getByText("Select an agent")).toBeInTheDocument()
      expect(screen.queryByText("Start a new chat")).not.toBeInTheDocument()
    })

    it("calls setActiveChatAgent instead of newChat when isPendingChat", () => {
      render(<NewChatScreen isPendingChat />)

      const claudeButton = screen.getByText("Claude").closest("button")!
      fireEvent.click(claudeButton)

      expect(mockWorkspaceStore.setActiveChatAgent).toHaveBeenCalledWith("claude")
      expect(mockWorkspaceStore.newChat).not.toHaveBeenCalled()
    })
  })

  describe("agent filtering", () => {
    it("hides disabled agents", () => {
      vi.mocked(configStore.isAgentEnabled).mockImplementation((agent) => agent === "claude")

      render(<NewChatScreen />)

      expect(screen.getByText("Claude")).toBeInTheDocument()
      expect(screen.queryByText("Codex")).not.toBeInTheDocument()
      expect(screen.queryByText("Copilot")).not.toBeInTheDocument()
    })

    it("shows all enabled agents", () => {
      vi.mocked(configStore.isAgentEnabled).mockReturnValue(true)

      render(<NewChatScreen />)

      expect(screen.getByText("Claude")).toBeInTheDocument()
      expect(screen.getByText("Codex")).toBeInTheDocument()
      expect(screen.getByText("Copilot")).toBeInTheDocument()
      expect(screen.getByText("Gemini")).toBeInTheDocument()
      expect(screen.getByText("OpenCode")).toBeInTheDocument()
    })
  })

  describe("archived chats link", () => {
    it("shows archived chats link when there are archived chats", () => {
      mockWorkspaceStore.hasArchivedChats = true

      render(<NewChatScreen />)

      expect(screen.getByText("Open archived chat")).toBeInTheDocument()
    })

    it("hides archived chats link when there are no archived chats", () => {
      mockWorkspaceStore.hasArchivedChats = false

      render(<NewChatScreen />)

      expect(screen.queryByText("Open archived chat")).not.toBeInTheDocument()
    })
  })
})
