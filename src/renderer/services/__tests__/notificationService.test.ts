import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { sendSystemNotification } from "../notificationService"

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  describe("sendSystemNotification", () => {
    it("posts through the send_completion_notification command with the completion text", async () => {
      await sendSystemNotification("overseer/grouse")

      expect(invoke).toHaveBeenCalledWith("send_completion_notification", {
        title: "Overseer",
        body: "Task complete in overseer/grouse",
      })
    })

    it("swallows invoke failures (notification is best-effort)", async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error("no tauri"))
      await expect(sendSystemNotification("overseer/grouse")).resolves.toBeUndefined()
    })
  })
})
