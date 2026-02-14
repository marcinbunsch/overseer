import { describe, it, expect, vi, beforeEach } from "vitest"
import { executeOverseerAction, type OverseerActionContext } from "../overseerActionExecutor"
import type { OverseerAction } from "../../utils/overseerActions"

// Mock ToastStore
vi.mock("../../stores/ToastStore", () => ({
  toastStore: {
    show: vi.fn(),
  },
}))

// Mock eventBus
vi.mock("../../utils/eventBus", () => ({
  eventBus: {
    emit: vi.fn(),
  },
}))

import { toastStore } from "../../stores/ToastStore"
import { eventBus } from "../../utils/eventBus"

describe("overseerActionExecutor", () => {
  let context: OverseerActionContext
  let renameChatMock: ReturnType<typeof vi.fn<(chatId: string, newLabel: string) => void>>

  beforeEach(() => {
    vi.clearAllMocks()
    renameChatMock = vi.fn<(chatId: string, newLabel: string) => void>()
    context = {
      chatId: "test-chat-id",
      renameChat: renameChatMock,
    }
  })

  describe("executeOverseerAction", () => {
    describe("rename_chat", () => {
      it("renames the chat with the provided title", async () => {
        const action: OverseerAction = {
          action: "rename_chat",
          params: { title: "My New Title" },
        }

        const result = await executeOverseerAction(action, context)

        expect(result.success).toBe(true)
        expect(renameChatMock).toHaveBeenCalledWith("test-chat-id", "My New Title")
        expect(toastStore.show).toHaveBeenCalledWith("Chat renamed to: My New Title")
      })
    })

    describe("open_pr", () => {
      it("emits open_pr event via eventBus", async () => {
        const action: OverseerAction = {
          action: "open_pr",
          params: { title: "Add feature X" },
        }

        const result = await executeOverseerAction(action, context)

        expect(result.success).toBe(true)
        expect(eventBus.emit).toHaveBeenCalledWith("overseer:open_pr", {
          title: "Add feature X",
          body: undefined,
        })
        expect(toastStore.show).toHaveBeenCalledWith("Creating PR: Add feature X")
      })

      it("includes body when provided", async () => {
        const action: OverseerAction = {
          action: "open_pr",
          params: { title: "Fix bug", body: "This fixes the issue" },
        }

        const result = await executeOverseerAction(action, context)

        expect(result.success).toBe(true)
        expect(eventBus.emit).toHaveBeenCalledWith("overseer:open_pr", {
          title: "Fix bug",
          body: "This fixes the issue",
        })
      })
    })

    describe("merge_branch", () => {
      it("emits merge_branch event via eventBus", async () => {
        const action: OverseerAction = {
          action: "merge_branch",
          params: { into: "main" },
        }

        const result = await executeOverseerAction(action, context)

        expect(result.success).toBe(true)
        expect(eventBus.emit).toHaveBeenCalledWith("overseer:merge_branch", { into: "main" })
        expect(toastStore.show).toHaveBeenCalledWith("Merging into main")
      })
    })

    describe("unknown action", () => {
      it("returns failure for unknown actions", async () => {
        const action = {
          action: "unknown_action",
          params: {},
        } as unknown as OverseerAction

        const result = await executeOverseerAction(action, context)

        expect(result.success).toBe(false)
        expect(result.message).toContain("Unknown action")
      })
    })
  })
})
