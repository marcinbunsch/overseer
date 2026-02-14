/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { projectRegistry } from "../../../stores/ProjectRegistry"
import { ChatTabs } from "../ChatTabs"

// Create a mock workspace store
const mockWorkspaceStore = {
  activeChats: [] as Array<{
    chat: { id: string; label: string; agentType: "claude" | "codex" | "copilot"; status: string }
  }>,
  activeChatId: null as string | null,
  hasArchivedChats: false,
  archivedChats: [] as Array<{
    chat: { id: string; label: string; agentType: "claude" | "codex" | "copilot"; status: string }
  }>,
  switchChat: vi.fn(),
  archiveChat: vi.fn(),
  renameChat: vi.fn(),
  newChat: vi.fn(),
}

vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    selectedWorkspaceStore: null,
  },
}))

vi.mock("../../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}))

describe("ChatTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the mock workspace store
    mockWorkspaceStore.activeChats = []
    mockWorkspaceStore.activeChatId = null
    mockWorkspaceStore.hasArchivedChats = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(projectRegistry as any).selectedWorkspaceStore = mockWorkspaceStore
  })

  describe("archive behavior", () => {
    it("archives chat directly when clicking the archive button", () => {
      const mockChat = {
        chat: {
          id: "test-chat-1",
          label: "Test Chat",
          agentType: "claude" as const,
          status: "idle" as const,
        },
      }
      mockWorkspaceStore.activeChats = [mockChat]
      mockWorkspaceStore.activeChatId = "test-chat-1"

      render(<ChatTabs />)

      // Find and click the archive button
      const archiveButton = screen.getByTitle("Archive chat")
      fireEvent.click(archiveButton)

      // Should archive directly without dialog
      expect(mockWorkspaceStore.archiveChat).toHaveBeenCalledWith("test-chat-1")
    })

    it("archives chat directly when there are multiple chats", () => {
      const mockChats = [
        {
          chat: {
            id: "test-chat-1",
            label: "Chat 1",
            agentType: "claude" as const,
            status: "idle" as const,
          },
        },
        {
          chat: {
            id: "test-chat-2",
            label: "Chat 2",
            agentType: "claude" as const,
            status: "idle" as const,
          },
        },
      ]
      mockWorkspaceStore.activeChats = mockChats
      mockWorkspaceStore.activeChatId = "test-chat-1"

      render(<ChatTabs />)

      // Find the archive button for the first chat
      const archiveButtons = screen.getAllByTitle("Archive chat")
      fireEvent.click(archiveButtons[0])

      // Should archive directly
      expect(mockWorkspaceStore.archiveChat).toHaveBeenCalledWith("test-chat-1")
    })
  })
})
