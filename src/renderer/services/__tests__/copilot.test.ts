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

  it("attaches stdout, stderr, and close listeners when starting server", async () => {
    const service = await freshService()

    // Mock so sendMessage fails early after setting up listeners
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stop early"))

    try {
      await service.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected
    }

    // Should have called listen 3 times for stdout, stderr, close
    expect(listen).toHaveBeenCalledWith("copilot:stdout:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("copilot:stderr:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("copilot:close:conv-1", expect.any(Function))
  })

  describe("permission request parsing", () => {
    // Helper to set up a service with a captured stdout handler
    async function setupWithStdoutCapture() {
      let stdoutHandler: ((event: { payload: string }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).includes("stdout")) {
          stdoutHandler = handler as (event: { payload: string }) => void
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

      return { service: copilotAgentService, eventCb, stdoutHandler: stdoutHandler! }
    }

    it("parses Bash permission request", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const permissionRequest = {
        jsonrpc: "2.0",
        id: 5,
        method: "session/request_permission",
        params: {
          sessionId: "sess-123",
          toolCall: {
            toolCallId: "shell-permission",
            title: "Install oxlint",
            kind: "execute",
            status: "pending",
            rawInput: {
              command: "pnpm add -D oxlint",
            },
          },
          options: [
            { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
            { optionId: "allow_always", kind: "allow_always", name: "Always allow" },
            { optionId: "reject_once", kind: "reject_once", name: "Deny" },
          ],
        },
      }

      stdoutHandler({ payload: JSON.stringify(permissionRequest) })

      // Command prefixes are computed by ChatStore, not the service
      expect(eventCb).toHaveBeenCalledWith({
        kind: "toolApproval",
        id: "5",
        name: "Bash",
        input: { command: "pnpm add -D oxlint" },
        displayInput: "pnpm add -D oxlint",
        options: [
          { id: "allow_once", name: "Allow once", kind: "allow_once" },
          { id: "allow_always", name: "Always allow", kind: "allow_always" },
          { id: "reject_once", name: "Deny", kind: "reject_once" },
        ],
      })
    })

    it("parses WebFetch permission request with URL display", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const permissionRequest = {
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: {
          sessionId: "sess-123",
          toolCall: {
            toolCallId: "url-permission",
            title: "Fetch web content",
            kind: "fetch",
            status: "pending",
            rawInput: { url: "https://oxc.rs/docs" },
          },
          options: [{ optionId: "allow_once", kind: "allow_once", name: "Allow once" }],
        },
      }

      stdoutHandler({ payload: JSON.stringify(permissionRequest) })

      expect(eventCb).toHaveBeenCalledWith({
        kind: "toolApproval",
        id: "0",
        name: "WebFetch",
        input: { url: "https://oxc.rs/docs" },
        displayInput: "https://oxc.rs/docs",
        options: [{ id: "allow_once", name: "Allow once", kind: "allow_once" }],
      })
    })

    it("parses Read permission request with path display", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const permissionRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "session/request_permission",
        params: {
          sessionId: "sess-123",
          toolCall: {
            toolCallId: "read-permission",
            title: "Read file",
            kind: "read",
            status: "pending",
            rawInput: { path: "/Users/test/file.ts" },
          },
          options: [{ optionId: "allow_once", kind: "allow_once", name: "Allow once" }],
        },
      }

      stdoutHandler({ payload: JSON.stringify(permissionRequest) })

      expect(eventCb).toHaveBeenCalledWith({
        kind: "toolApproval",
        id: "3",
        name: "Read",
        input: { path: "/Users/test/file.ts" },
        displayInput: "/Users/test/file.ts",
        options: [{ id: "allow_once", name: "Allow once", kind: "allow_once" }],
      })
    })

    it("falls back to JSON for unknown input types", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const permissionRequest = {
        jsonrpc: "2.0",
        id: 9,
        method: "session/request_permission",
        params: {
          sessionId: "sess-123",
          toolCall: {
            toolCallId: "custom-permission",
            title: "Custom action",
            kind: "other",
            status: "pending",
            rawInput: { foo: "bar", count: 42 },
          },
          options: [{ optionId: "allow_once", kind: "allow_once", name: "Allow once" }],
        },
      }

      stdoutHandler({ payload: JSON.stringify(permissionRequest) })

      expect(eventCb).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Custom action",
          displayInput: JSON.stringify({ foo: "bar", count: 42 }, null, 2),
        })
      )
    })

    it("handles empty rawInput gracefully", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const permissionRequest = {
        jsonrpc: "2.0",
        id: 11,
        method: "session/request_permission",
        params: {
          sessionId: "sess-123",
          toolCall: {
            toolCallId: "empty-permission",
            title: "Empty input",
            kind: "execute",
            status: "pending",
            // No rawInput
          },
          options: [{ optionId: "allow_once", kind: "allow_once", name: "Allow once" }],
        },
      }

      stdoutHandler({ payload: JSON.stringify(permissionRequest) })

      expect(eventCb).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Bash",
          input: {},
          displayInput: "{}",
        })
      )
    })
  })

  describe("Task handling", () => {
    async function setupWithStdoutCapture() {
      let stdoutHandler: ((event: { payload: string }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).includes("stdout")) {
          stdoutHandler = handler as (event: { payload: string }) => void
        }
        return () => {}
      })

      vi.resetModules()
      const { copilotAgentService } = await import("../copilot")

      const eventCb = vi.fn()
      copilotAgentService.onEvent("conv-1", eventCb)

      vi.mocked(invoke).mockRejectedValueOnce(new Error("stop"))
      try {
        await copilotAgentService.sendMessage("conv-1", "test", "/tmp")
      } catch {
        // Expected
      }

      return { service: copilotAgentService, eventCb, stdoutHandler: stdoutHandler! }
    }

    it("detects Task when rawInput has agent_type and emits with toolUseId", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      const taskToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "task-123",
            title: "Find permission prompt display",
            kind: "other",
            status: "pending",
            rawInput: {
              agent_type: "explore",
              description: "Find permission prompt display",
              prompt: "Find where the permission prompt is shown",
            },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(taskToolCall) })

      expect(eventCb).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "message",
          toolMeta: { toolName: "Task" },
          toolUseId: "task-123",
        })
      )

      // Check that agent_type was transformed to subagent_type
      const call = eventCb.mock.calls.find(
        (c: { kind: string; toolUseId?: string }[]) => c[0].toolUseId === "task-123"
      )
      expect(call).toBeDefined()
      const content = JSON.parse(call![0].content.replace("[Task]\n", ""))
      expect(content.subagent_type).toBe("explore")
      expect(content.agent_type).toBeUndefined()
    })

    it("assigns parentToolUseId to child tools of active task", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      // Start a task
      const taskToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "task-456",
            title: "Explore code",
            kind: "other",
            status: "pending",
            rawInput: {
              agent_type: "explore",
              description: "Explore code",
              prompt: "Find something",
            },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(taskToolCall) })

      // Now a child tool arrives
      const childToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "child-789",
            title: "Read file.ts",
            kind: "read",
            status: "pending",
            rawInput: {
              path: "/some/file.ts",
            },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(childToolCall) })

      // Child tool should have parentToolUseId
      expect(eventCb).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "message",
          toolMeta: { toolName: "Read" },
          parentToolUseId: "task-456",
        })
      )
    })

    it("clears activeTask when task completes", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      // Start a task
      const taskToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "task-abc",
            title: "Explore",
            kind: "other",
            status: "pending",
            rawInput: {
              agent_type: "explore",
              description: "Explore",
              prompt: "Find something",
            },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(taskToolCall) })

      // Complete the task
      const taskComplete = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "task-abc",
            status: "completed",
            content: [{ type: "text", text: "Task result" }],
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(taskComplete) })

      // Now another regular tool - should NOT have parentToolUseId
      const nextToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "next-tool",
            title: "Read another file",
            kind: "read",
            status: "pending",
            rawInput: { path: "/another/file.ts" },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(nextToolCall) })

      // Find the call for the next tool
      const nextToolEvent = eventCb.mock.calls.find(
        (c: { toolMeta?: { toolName: string }; parentToolUseId?: string }[]) =>
          c[0].toolMeta?.toolName === "Read" && c[0].parentToolUseId === undefined
      )
      expect(nextToolEvent).toBeDefined()
    })

    it("regular tools without active task have no parentToolUseId", async () => {
      const { eventCb, stdoutHandler } = await setupWithStdoutCapture()

      // Regular tool with no active task
      const regularToolCall = {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess-123",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "regular-123",
            title: "Run tests",
            kind: "execute",
            status: "pending",
            rawInput: { command: "pnpm test" },
          },
        },
      }

      stdoutHandler({ payload: JSON.stringify(regularToolCall) })

      expect(eventCb).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "message",
          toolMeta: { toolName: "Bash" },
          parentToolUseId: undefined,
        })
      )
    })
  })
})
