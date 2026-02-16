import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  handleWindowCloseRequest,
  type CloseRequestEvent,
  type WindowCloseDeps,
} from "../windowClose"

describe("handleWindowCloseRequest", () => {
  let mockEvent: CloseRequestEvent
  let mockDeps: WindowCloseDeps

  beforeEach(() => {
    mockEvent = {
      preventDefault: vi.fn(),
    }

    mockDeps = {
      hasRunningChats: vi.fn(() => false),
      flushAllChats: vi.fn(() => Promise.resolve()),
      showConfirm: vi.fn(() => Promise.resolve(true)),
      destroyWindow: vi.fn(() => Promise.resolve()),
    }
  })

  describe("when no chats are running", () => {
    it("should prevent default, flush chats, and destroy window", async () => {
      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(mockDeps.flushAllChats).toHaveBeenCalled()
      expect(mockDeps.destroyWindow).toHaveBeenCalled()
    })

    it("should not show confirmation dialog", async () => {
      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(mockDeps.showConfirm).not.toHaveBeenCalled()
    })
  })

  describe("when chats are running", () => {
    beforeEach(() => {
      vi.mocked(mockDeps.hasRunningChats).mockReturnValue(true)
    })

    it("should show confirmation dialog with correct options", async () => {
      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(mockDeps.showConfirm).toHaveBeenCalledWith({
        title: "Quit Overseer?",
        description:
          "There are chats still running. Quitting will stop them. Are you sure you want to quit?",
        confirmLabel: "Quit",
      })
    })

    it("should prevent default before showing dialog", async () => {
      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })

    describe("when user confirms", () => {
      beforeEach(() => {
        vi.mocked(mockDeps.showConfirm).mockResolvedValue(true)
      })

      it("should flush chats and destroy window", async () => {
        await handleWindowCloseRequest(mockEvent, mockDeps)

        expect(mockDeps.flushAllChats).toHaveBeenCalled()
        expect(mockDeps.destroyWindow).toHaveBeenCalled()
      })
    })

    describe("when user cancels", () => {
      beforeEach(() => {
        vi.mocked(mockDeps.showConfirm).mockResolvedValue(false)
      })

      it("should not flush chats or destroy window", async () => {
        await handleWindowCloseRequest(mockEvent, mockDeps)

        expect(mockDeps.flushAllChats).not.toHaveBeenCalled()
        expect(mockDeps.destroyWindow).not.toHaveBeenCalled()
      })

      it("should still have called preventDefault", async () => {
        await handleWindowCloseRequest(mockEvent, mockDeps)

        expect(mockEvent.preventDefault).toHaveBeenCalled()
      })
    })
  })

  describe("operation order", () => {
    it("should flush before destroy when no running chats", async () => {
      const callOrder: string[] = []
      vi.mocked(mockDeps.flushAllChats).mockImplementation(async () => {
        callOrder.push("flush")
      })
      vi.mocked(mockDeps.destroyWindow).mockImplementation(async () => {
        callOrder.push("destroy")
      })

      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(callOrder).toEqual(["flush", "destroy"])
    })

    it("should flush before destroy when user confirms", async () => {
      vi.mocked(mockDeps.hasRunningChats).mockReturnValue(true)
      vi.mocked(mockDeps.showConfirm).mockResolvedValue(true)

      const callOrder: string[] = []
      vi.mocked(mockDeps.flushAllChats).mockImplementation(async () => {
        callOrder.push("flush")
      })
      vi.mocked(mockDeps.destroyWindow).mockImplementation(async () => {
        callOrder.push("destroy")
      })

      await handleWindowCloseRequest(mockEvent, mockDeps)

      expect(callOrder).toEqual(["flush", "destroy"])
    })
  })
})
