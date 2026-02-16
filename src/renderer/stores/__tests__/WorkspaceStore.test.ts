import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

// Mock Tauri APIs before importing WorkspaceStore
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => Promise.resolve("/home/testuser/")),
}))

vi.mock("../ConfigStore", () => ({
  configStore: {
    defaultAgent: "claude",
  },
}))

vi.mock("../ToastStore", () => ({
  toastStore: {
    show: vi.fn(),
  },
}))

const mockStopChat = vi.fn()
const mockRemoveChat = vi.fn()
vi.mock("../../services/agentRegistry", () => ({
  getAgentService: vi.fn(() => ({
    spawn: vi.fn(),
    stopChat: mockStopChat,
    removeChat: mockRemoveChat,
  })),
}))

import { WorkspaceStore } from "../WorkspaceStore"
import type { Workspace, Chat } from "../../types"

describe("WorkspaceStore", () => {
  const mockWorkspace: Workspace = {
    id: "wt-1",
    projectId: "proj-1",
    branch: "main",
    path: "/home/testuser/myrepo",
    isArchived: false,
    createdAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  describe("runningCount", () => {
    it("returns 0 when no chats exist", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")
      expect(store.runningCount).toBe(0)
    })

    it("returns 0 when all chats are idle", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      // Access private _chats to set up test state
      const mockChat1 = { chat: { status: "idle", isArchived: false } as Chat } as never
      const mockChat2 = { chat: { status: "idle", isArchived: false } as Chat } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1, mockChat2]

      expect(store.runningCount).toBe(0)
    })

    it("counts running chats correctly", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = { chat: { status: "running", isArchived: false } as Chat } as never
      const mockChat2 = { chat: { status: "idle", isArchived: false } as Chat } as never
      const mockChat3 = { chat: { status: "running", isArchived: false } as Chat } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1, mockChat2, mockChat3]

      expect(store.runningCount).toBe(2)
    })

    it("excludes archived chats from running count", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = { chat: { status: "running", isArchived: false } as Chat } as never
      const mockChat2 = { chat: { status: "running", isArchived: true } as Chat } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1, mockChat2]

      expect(store.runningCount).toBe(1)
    })
  })

  describe("allChats", () => {
    it("returns empty array when no chats exist", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")
      expect(store.allChats).toEqual([])
    })

    it("returns all chats including archived ones", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = { chat: { status: "idle", isArchived: false } as Chat } as never
      const mockChat2 = { chat: { status: "running", isArchived: true } as Chat } as never
      const mockChat3 = { chat: { status: "idle", isArchived: false } as Chat } as never
      // @ts-expect-error - accessing private property for testing
      store._chats.push(mockChat1, mockChat2, mockChat3)

      expect(store.allChats).toHaveLength(3)
      // Check that it includes both archived and non-archived
      const statuses = store.allChats.map((c) => c.chat.status)
      expect(statuses).toContain("idle")
      expect(statuses).toContain("running")
    })

    it("differs from activeChats which filters archived", () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = { chat: { status: "idle", isArchived: false } as Chat } as never
      const mockChat2 = { chat: { status: "running", isArchived: true } as Chat } as never
      // @ts-expect-error - accessing private property for testing
      store._chats.push(mockChat1, mockChat2)

      // allChats includes all chats
      expect(store.allChats).toHaveLength(2)
      // activeChats filters out archived
      expect(store.activeChats).toHaveLength(1)
    })
  })

  describe("deleteChat", () => {
    it("removes chat from the array", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "idle", isArchived: true } as Chat,
      } as never
      const mockChat2 = {
        id: "chat-2",
        chat: { id: "chat-2", status: "idle", isArchived: false } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1, mockChat2]

      await store.deleteChat("chat-1")

      expect(store.allChats).toHaveLength(1)
      expect(store.allChats[0].id).toBe("chat-2")
    })

    it("switches active chat when deleting the active one", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "idle", isArchived: false } as Chat,
      } as never
      const mockChat2 = {
        id: "chat-2",
        chat: { id: "chat-2", status: "idle", isArchived: false } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1, mockChat2]
      store.activeChatId = "chat-1"

      await store.deleteChat("chat-1")

      expect(store.activeChatId).toBe("chat-2")
    })

    it("sets activeChatId to null when deleting the last chat", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "idle", isArchived: false } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1]
      store.activeChatId = "chat-1"

      await store.deleteChat("chat-1")

      expect(store.activeChatId).toBeNull()
      expect(store.allChats).toHaveLength(0)
    })

    it("stops and removes agent when chat has agentType", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "running", isArchived: false, agentType: "claude" } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1]

      await store.deleteChat("chat-1")

      expect(mockStopChat).toHaveBeenCalledWith("chat-1")
      expect(mockRemoveChat).toHaveBeenCalledWith("chat-1")
    })

    it("deletes chat file from disk", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "idle", isArchived: true } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1]

      await store.deleteChat("chat-1")

      expect(invoke).toHaveBeenCalledWith("delete_chat", {
        projectName: "myrepo",
        workspaceName: "myrepo",
        chatId: "chat-1",
      })
    })

    it("does nothing when chat does not exist", async () => {
      const store = new WorkspaceStore(mockWorkspace, "myrepo")

      const mockChat1 = {
        id: "chat-1",
        chat: { id: "chat-1", status: "idle", isArchived: false } as Chat,
      } as never
      // @ts-expect-error - accessing private property for testing
      store._chats = [mockChat1]

      await store.deleteChat("nonexistent-chat")

      expect(store.allChats).toHaveLength(1)
    })
  })
})
