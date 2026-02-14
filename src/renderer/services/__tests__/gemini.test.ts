import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    geminiPath: "gemini",
    geminiApprovalMode: "yolo",
    loaded: true,
  },
}))

describe("GeminiAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../gemini")
    return mod.geminiAgentService
  }

  it("starts with no running chats", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendMessage invokes start_gemini_server for new chat", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "hello",
        workingDir: "/tmp/workdir",
        sessionId: null,
        modelVersion: null,
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage passes modelVersion to start_gemini_server", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, "gemini-2.5-pro")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "hello",
        workingDir: "/tmp/workdir",
        sessionId: null,
        modelVersion: "gemini-2.5-pro",
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage passes logDir when provided", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", "/tmp/logs", "gemini-2.5-flash")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "hello",
        workingDir: "/tmp/workdir",
        sessionId: null,
        modelVersion: "gemini-2.5-flash",
        approvalMode: "yolo",
        logDir: "/tmp/logs",
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage uses passed permissionMode for approvalMode", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, null, "auto_edit")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "hello",
        workingDir: "/tmp/workdir",
        sessionId: null,
        modelVersion: null,
        approvalMode: "auto_edit",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage falls back to configStore.geminiApprovalMode when permissionMode is null", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, null, null)

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "hello",
        workingDir: "/tmp/workdir",
        sessionId: null,
        modelVersion: null,
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage prepends initPrompt on first message of new session", async () => {
    const service = await freshService()

    void service.sendMessage(
      "chat-1",
      "user prompt",
      "/tmp",
      undefined,
      null,
      null,
      "Read docs/ARCH.md first"
    )

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "Read docs/ARCH.md first\n\nuser prompt",
        workingDir: "/tmp",
        sessionId: null,
        modelVersion: null,
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage does NOT prepend initPrompt on follow-up messages", async () => {
    const service = await freshService()

    // Set up a chat that already has a session ID
    service.setSessionId("chat-1", "session-123")

    void service.sendMessage(
      "chat-1",
      "follow up",
      "/tmp",
      undefined,
      null,
      null,
      "init instructions"
    )

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "follow up", // No initPrompt prepended
        workingDir: "/tmp",
        sessionId: "session-123",
        modelVersion: null,
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage includes sessionId for resume when available", async () => {
    const service = await freshService()

    // Set a session ID to simulate resume
    service.setSessionId("chat-1", "session-abc-123")

    void service.sendMessage("chat-1", "continue", "/tmp/workdir")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_gemini_server", {
        serverId: "chat-1",
        geminiPath: "gemini",
        prompt: "continue",
        workingDir: "/tmp/workdir",
        sessionId: "session-abc-123",
        modelVersion: null,
        approvalMode: "yolo",
        logDir: null,
        logId: "chat-1",
      })
    })

    service.stopChat("chat-1")
  })

  it("stopChat invokes stop_gemini_server and marks as not running", async () => {
    const service = await freshService()

    // Manually set up a running chat state
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    chat.sessionId = "session-123"

    await service.stopChat("chat-1")

    expect(invoke).toHaveBeenCalledWith("stop_gemini_server", { serverId: "chat-1" })
    expect(service.isRunning("chat-1")).toBe(false)
  })

  it("setSessionId and getSessionId work correctly", async () => {
    const service = await freshService()

    service.setSessionId("chat-1", "session-xyz")
    expect(service.getSessionId("chat-1")).toBe("session-xyz")

    service.setSessionId("chat-1", null)
    expect(service.getSessionId("chat-1")).toBeNull()
  })

  it("removeChat cleans up all state", async () => {
    const service = await freshService()

    // Set up some state
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    service.onEvent("chat-1", vi.fn())
    service.onDone("chat-1", vi.fn())

    service.removeChat("chat-1")

    expect(service.isRunning("chat-1")).toBe(false)
    expect(service.getSessionId("chat-1")).toBeNull()
  })

  it("onEvent and onDone register callbacks", async () => {
    const service = await freshService()

    const eventCb = vi.fn()
    const doneCb = vi.fn()

    service.onEvent("chat-1", eventCb)
    service.onDone("chat-1", doneCb)

    // Callbacks are stored internally — verify they don't throw
    expect(() => service.onEvent("chat-1", eventCb)).not.toThrow()
    expect(() => service.onDone("chat-1", doneCb)).not.toThrow()
  })

  it("sendToolApproval is a no-op (doesn't throw)", async () => {
    const service = await freshService()

    // Should not throw — Gemini doesn't support interactive tool approvals
    await expect(service.sendToolApproval("chat-1", "123", true)).resolves.toBeUndefined()
    await expect(service.sendToolApproval("chat-1", "456", false)).resolves.toBeUndefined()
  })

  it("attaches stdout, stderr, and close listeners", async () => {
    const service = await freshService()

    service.sendMessage("chat-1", "hello", "/tmp")

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith("gemini:stdout:chat-1", expect.any(Function))
      expect(listen).toHaveBeenCalledWith("gemini:stderr:chat-1", expect.any(Function))
      expect(listen).toHaveBeenCalledWith("gemini:close:chat-1", expect.any(Function))
    })

    service.stopChat("chat-1")
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    const service = await freshService()

    // First call is stop_gemini_server (returns success), second is start_gemini_server (fails)
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "stop_gemini_server") return undefined
      if (cmd === "start_gemini_server") throw new Error("Failed to spawn: command not found")
      return undefined
    })

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow(
      /Gemini CLI not found/
    )
  })

  it("throws user-friendly error when spawn fails with ENOENT", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "stop_gemini_server") return undefined
      if (cmd === "start_gemini_server") throw new Error("Failed to spawn: ENOENT")
      return undefined
    })

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow(
      /Gemini CLI not found/
    )
  })

  it("preserves original error message for non-spawn errors", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "stop_gemini_server") return undefined
      if (cmd === "start_gemini_server") throw new Error("Network timeout")
      return undefined
    })

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow("Network timeout")
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    vi.resetModules()

    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "stop_gemini_server") return undefined
      if (cmd === "start_gemini_server") throw new Error("Failed to spawn: command not found")
      return undefined
    })

    const { geminiAgentService } = await import("../gemini")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    toolAvailabilityStore.gemini = null

    try {
      await geminiAgentService.sendMessage("chat-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.gemini).not.toBeNull()
    expect(toolAvailabilityStore.gemini!.available).toBe(false)
    expect(toolAvailabilityStore.gemini!.error).toContain("command not found")
  })

  describe("rate limit handling", () => {
    it("emits a new message after rate limit info instead of appending via text event", async () => {
      vi.resetModules()

      // Capture the listeners so we can trigger events manually
      const listeners: Record<string, (event: { payload: string }) => void> = {}
      vi.mocked(listen).mockImplementation(async (eventName, callback) => {
        listeners[eventName as string] = callback as (event: { payload: string }) => void
        return () => {}
      })
      vi.mocked(invoke).mockResolvedValue(undefined)

      const { geminiAgentService } = await import("../gemini")

      const events: { kind: string; content?: string; text?: string; isInfo?: boolean }[] = []
      geminiAgentService.onEvent("chat-1", (event) => {
        events.push(event as { kind: string; content?: string; text?: string; isInfo?: boolean })
      })

      await geminiAgentService.sendMessage("chat-1", "hello", "/tmp")

      // Simulate: first, a rate limit stderr message
      listeners["gemini:stderr:chat-1"]({
        payload:
          "Attempt 1 failed: You have exhausted your capacity. Your quota will reset after 2s",
      })

      // Now simulate the delta message that comes after the rate limit
      listeners["gemini:stdout:chat-1"]({
        payload: JSON.stringify({
          type: "message",
          role: "assistant",
          content: "Here is my response",
          delta: true,
        }),
      })

      // Should have:
      // 1. An info message for the rate limit
      // 2. A new message (not text) for the response after rate limit
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "message",
          isInfo: true,
        })
      )

      // The response after rate limit should be a "message" event, not a "text" event
      const responseEvent = events.find(
        (e) => e.kind === "message" && e.content === "Here is my response"
      )
      expect(responseEvent).toBeDefined()
      expect(responseEvent?.isInfo).toBeFalsy()

      geminiAgentService.stopChat("chat-1")
    })

    it("uses text events for normal streaming (no rate limit)", async () => {
      vi.resetModules()

      const listeners: Record<string, (event: { payload: string }) => void> = {}
      vi.mocked(listen).mockImplementation(async (eventName, callback) => {
        listeners[eventName as string] = callback as (event: { payload: string }) => void
        return () => {}
      })
      vi.mocked(invoke).mockResolvedValue(undefined)

      const { geminiAgentService } = await import("../gemini")

      const events: { kind: string; content?: string; text?: string }[] = []
      geminiAgentService.onEvent("chat-1", (event) => {
        events.push(event as { kind: string; content?: string; text?: string })
      })

      await geminiAgentService.sendMessage("chat-1", "hello", "/tmp")

      // Simulate normal delta messages (no rate limit)
      listeners["gemini:stdout:chat-1"]({
        payload: JSON.stringify({
          type: "message",
          role: "assistant",
          content: "Hello ",
          delta: true,
        }),
      })

      listeners["gemini:stdout:chat-1"]({
        payload: JSON.stringify({
          type: "message",
          role: "assistant",
          content: "world!",
          delta: true,
        }),
      })

      // Should be text events for streaming
      expect(events).toContainEqual({ kind: "text", text: "Hello " })
      expect(events).toContainEqual({ kind: "text", text: "world!" })

      geminiAgentService.stopChat("chat-1")
    })
  })
})
