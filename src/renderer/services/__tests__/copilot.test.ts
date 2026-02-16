import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

describe("CopilotAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../copilot")
    return mod.copilotAgentService
  }

  it("starts with no running conversations", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendToolApproval sends allow_once response with jsonrpc field", async () => {
    const service = await freshService()

    // Set up a chat first by calling setSessionId which creates the internal state
    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "10", true, { command: "ls" })

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "copilot_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.jsonrpc).toBe("2.0")
    // ACP uses outcome: { outcome: "selected", optionId } format
    expect(data.result.outcome.outcome).toBe("selected")
    expect(data.result.outcome.optionId).toBe("allow_once")
  })

  it("sendToolApproval sends reject_once response with jsonrpc field", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "10", false)

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "copilot_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.jsonrpc).toBe("2.0")
    // ACP uses outcome: { outcome: "selected", optionId } format
    expect(data.result.outcome.outcome).toBe("selected")
    expect(data.result.outcome.optionId).toBe("reject_once")
  })

  it("sendToolApproval handles numeric request IDs", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "42", true)

    // Should parse the numeric string ID
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "copilot_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.id).toBe(42) // Should be a number, not "42"
  })

  it("interruptTurn sends session/cancel but does NOT kill the server", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.interruptTurn("conv-1")

    // Should have sent cancel notification
    expect(invoke).toHaveBeenCalledWith("copilot_stdin", {
      serverId: "conv-1",
      data: expect.stringContaining("session/cancel"),
    })

    // Should NOT have killed the server
    expect(invoke).not.toHaveBeenCalledWith("stop_copilot_server", expect.anything())
  })

  it("interruptTurn does nothing if no sessionId", async () => {
    const service = await freshService()

    // No sessionId set
    await service.interruptTurn("conv-1")

    // Should not have sent anything
    expect(invoke).not.toHaveBeenCalledWith("copilot_stdin", expect.anything())
  })

  it("stopChat interrupts turn then kills server", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.stopChat("conv-1")

    // Should have sent cancel notification first
    expect(invoke).toHaveBeenCalledWith("copilot_stdin", {
      serverId: "conv-1",
      data: expect.stringContaining("session/cancel"),
    })

    // Then killed the server
    expect(invoke).toHaveBeenCalledWith("stop_copilot_server", { serverId: "conv-1" })
    expect(service.isRunning("conv-1")).toBe(false)
  })

  it("setSessionId and getSessionId work correctly", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "session-xyz")
    expect(service.getSessionId("conv-1")).toBe("session-xyz")

    service.setSessionId("conv-1", null)
    expect(service.getSessionId("conv-1")).toBeNull()
  })

  it("removeChat cleans up all state", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")
    service.onEvent("conv-1", vi.fn())
    service.onDone("conv-1", vi.fn())

    service.removeChat("conv-1")

    expect(service.isRunning("conv-1")).toBe(false)
    expect(service.getSessionId("conv-1")).toBeNull()
  })

  it("onEvent and onDone register callbacks", async () => {
    const service = await freshService()

    const eventCb = vi.fn()
    const doneCb = vi.fn()

    service.onEvent("conv-1", eventCb)
    service.onDone("conv-1", doneCb)

    // Callbacks are stored internally — verify they don't throw
    expect(() => service.onEvent("conv-1", eventCb)).not.toThrow()
    expect(() => service.onDone("conv-1", doneCb)).not.toThrow()
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Copilot CLI not found/
    )
  })

  it("throws user-friendly error when spawn fails with ENOENT", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: ENOENT"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Copilot CLI not found/
    )
  })

  it("preserves original error message for non-spawn errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Network timeout"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow("Network timeout")
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    vi.resetModules()

    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const { copilotAgentService } = await import("../copilot")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    toolAvailabilityStore.copilot = null

    try {
      await copilotAgentService.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.copilot).not.toBeNull()
    expect(toolAvailabilityStore.copilot!.available).toBe(false)
    expect(toolAvailabilityStore.copilot!.error).toContain("command not found")
  })

  it("attaches stdout, event, and close listeners when starting server", async () => {
    const service = await freshService()

    // Mock so sendMessage fails early after setting up listeners
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stop early"))

    try {
      await service.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected
    }

    // Should have called listen 3 times for stdout, event, close
    expect(listen).toHaveBeenCalledWith("copilot:stdout:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("copilot:event:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("copilot:close:conv-1", expect.any(Function))
  })

  describe("Rust event handling", () => {
    // Helper to set up a service with a captured event handler
    async function setupWithEventCapture() {
      let eventHandler: ((event: { payload: unknown }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).includes("copilot:event:")) {
          eventHandler = handler as (event: { payload: unknown }) => void
        }
        return () => {} // UnlistenFn
      })

      vi.resetModules()
      const { copilotAgentService } = await import("../copilot")

      const eventCb = vi.fn()
      copilotAgentService.onEvent("conv-1", eventCb)

      // Trigger listener attachment by starting server (will fail but that's ok)
      vi.mocked(invoke).mockRejectedValueOnce(new Error("stop"))
      try {
        await copilotAgentService.sendMessage("conv-1", "test", "/tmp")
      } catch {
        // Expected
      }

      return { service: copilotAgentService, eventCb, eventHandler: eventHandler! }
    }

    it("handles Rust Text event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      // Rust sends internally-tagged event: {"kind": "text", "text": "Hello"}
      eventHandler({ payload: { kind: "text", text: "Hello world" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "text", text: "Hello world" })
    })

    it("handles Rust ToolApproval event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      // Rust sends internally-tagged event
      eventHandler({
        payload: {
          kind: "toolApproval",
          request_id: "5",
          name: "Bash",
          input: { command: "pnpm add -D oxlint" },
          display_input: "pnpm add -D oxlint",
          prefixes: ["pnpm add"],
          auto_approved: false,
        },
      })

      expect(eventCb).toHaveBeenCalledWith({
        kind: "toolApproval",
        id: "5",
        name: "Bash",
        input: { command: "pnpm add -D oxlint" },
        displayInput: "pnpm add -D oxlint",
        commandPrefixes: ["pnpm add"],
      })
    })

    it("skips auto-approved ToolApproval events", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      // Rust sends auto-approved event
      eventHandler({
        payload: {
          kind: "toolApproval",
          request_id: "5",
          name: "Bash",
          input: { command: "git status" },
          display_input: "git status",
          prefixes: ["git status"],
          auto_approved: true,
        },
      })

      // Should NOT emit to frontend
      expect(eventCb).not.toHaveBeenCalled()
    })

    it("handles Rust Message event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({
        payload: {
          kind: "message",
          content: '[Bash]\n{"command": "git status"}',
          tool_meta: { tool_name: "Bash" },
          parent_tool_use_id: "task-123",
        },
      })

      expect(eventCb).toHaveBeenCalledWith({
        kind: "message",
        content: '[Bash]\n{"command": "git status"}',
        toolMeta: { toolName: "Bash", linesAdded: undefined, linesRemoved: undefined },
        parentToolUseId: "task-123",
        toolUseId: undefined,
        isInfo: undefined,
      })
    })

    it("handles Rust BashOutput event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({
        payload: {
          kind: "bashOutput",
          text: "file.txt\n",
        },
      })

      expect(eventCb).toHaveBeenCalledWith({ kind: "bashOutput", text: "file.txt\n" })
    })

    it("handles Rust TurnComplete event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "turnComplete" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "turnComplete" })
    })

    it("handles Rust SessionId event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "sessionId", session_id: "sess-abc-123" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "sessionId", sessionId: "sess-abc-123" })
    })

    it("logs warning for unknown event kinds", async () => {
      const { eventHandler } = await setupWithEventCapture()
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

      eventHandler({ payload: { kind: "unknownEventType" } })

      expect(consoleWarn).toHaveBeenCalledWith("Unknown Copilot event kind: unknownEventType")
      consoleWarn.mockRestore()
    })
  })
})
