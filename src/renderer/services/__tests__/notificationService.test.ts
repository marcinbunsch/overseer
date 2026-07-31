import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen, type EventCallback } from "@tauri-apps/api/event"
import { sendSystemNotification, initNotificationClickHandler } from "../notificationService"

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  describe("sendSystemNotification", () => {
    it("posts through the send_completion_notification command with the completion text", async () => {
      await sendSystemNotification("overseer/grouse", "wt-1", "chat-9")

      expect(invoke).toHaveBeenCalledWith("send_completion_notification", {
        title: "Overseer",
        body: "Task complete in overseer/grouse",
        workspaceId: "wt-1",
        chatId: "chat-9",
      })
    })

    it("swallows invoke failures (notification is best-effort)", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("no tauri"))
      await expect(
        sendSystemNotification("overseer/grouse", "wt-1", "chat-9")
      ).resolves.toBeUndefined()
    })
  })

  describe("initNotificationClickHandler", () => {
    it("navigates to the workspace/chat carried by the click event", async () => {
      let handler: EventCallback<{ workspaceId?: string; chatId?: string }> | undefined
      vi.mocked(listen).mockImplementation((_event, cb) => {
        handler = cb as EventCallback<{ workspaceId?: string; chatId?: string }>
        return Promise.resolve(vi.fn())
      })
      const onNavigate = vi.fn()

      await initNotificationClickHandler(onNavigate)
      expect(listen).toHaveBeenCalledWith("notification://clicked", expect.any(Function))

      handler?.({
        event: "notification://clicked",
        id: 1,
        payload: { workspaceId: "wt-1", chatId: "chat-9" },
      })

      expect(onNavigate).toHaveBeenCalledWith("wt-1", "chat-9")
    })

    it("ignores an event missing the ids", async () => {
      let handler: EventCallback<{ workspaceId?: string; chatId?: string }> | undefined
      vi.mocked(listen).mockImplementation((_event, cb) => {
        handler = cb as EventCallback<{ workspaceId?: string; chatId?: string }>
        return Promise.resolve(vi.fn())
      })
      const onNavigate = vi.fn()

      await initNotificationClickHandler(onNavigate)
      handler?.({ event: "notification://clicked", id: 1, payload: {} })

      expect(onNavigate).not.toHaveBeenCalled()
    })

    it("unsubscribes the listener when the returned cleanup is called", async () => {
      const unlisten = vi.fn()
      vi.mocked(listen).mockResolvedValueOnce(unlisten)

      const cleanup = await initNotificationClickHandler(vi.fn())
      cleanup()

      expect(unlisten).toHaveBeenCalledTimes(1)
    })
  })
})
