import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

describe("ClaudeAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../claude")
    return mod.claudeAgentService
  }

  it("starts with no running conversations", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendMessage invokes start_agent for new conversation", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp/workdir")

    expect(invoke).toHaveBeenCalledWith("start_agent", {
      conversationId: "conv-1",
      prompt: "hello",
      workingDir: "/tmp/workdir",
      agentPath: "claude",
      sessionId: null,
      modelVersion: null,
      logDir: null,
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
    })
    expect(service.isRunning("conv-1")).toBe(true)
  })

  it("sendMessage passes modelVersion to start_agent", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp/workdir", undefined, "opus")

    expect(invoke).toHaveBeenCalledWith("start_agent", {
      conversationId: "conv-1",
      prompt: "hello",
      workingDir: "/tmp/workdir",
      agentPath: "claude",
      sessionId: null,
      modelVersion: "opus",
      logDir: null,
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
    })
  })

  it("sendMessage passes logDir and modelVersion when provided", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp/workdir", "/tmp/logs", "haiku")

    expect(invoke).toHaveBeenCalledWith("start_agent", {
      conversationId: "conv-1",
      prompt: "hello",
      workingDir: "/tmp/workdir",
      agentPath: "claude",
      sessionId: null,
      modelVersion: "haiku",
      logDir: "/tmp/logs",
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
    })
  })

  it("sendMessage prepends initPrompt to prompt", async () => {
    const service = await freshService()

    await service.sendMessage(
      "conv-1",
      "hello",
      "/tmp/workdir",
      undefined,
      null,
      null,
      "Read docs/ARCH.md first"
    )

    expect(invoke).toHaveBeenCalledWith("start_agent", {
      conversationId: "conv-1",
      prompt: "Read docs/ARCH.md first\n\nhello",
      workingDir: "/tmp/workdir",
      agentPath: "claude",
      sessionId: null,
      modelVersion: null,
      logDir: null,
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
    })
  })

  it("sendMessage sends follow-up via stdin when already running", async () => {
    const service = await freshService()

    // Start first message
    await service.sendMessage("conv-1", "first", "/tmp")

    // Manually set session ID (normally comes from event)
    service.setSessionId("conv-1", "session-abc")

    // Send follow-up
    await service.sendMessage("conv-1", "follow up", "/tmp")

    expect(invoke).toHaveBeenCalledWith("agent_stdin", {
      conversationId: "conv-1",
      data: expect.stringContaining("follow up"),
    })
  })

  it("sendToolApproval sends allow response", async () => {
    const service = await freshService()

    await service.sendToolApproval("conv-1", "req-1", true, { command: "ls" })

    expect(invoke).toHaveBeenCalledWith("agent_stdin", {
      conversationId: "conv-1",
      data: expect.stringContaining('"behavior":"allow"'),
    })
  })

  it("sendToolApproval sends deny response", async () => {
    const service = await freshService()

    await service.sendToolApproval("conv-1", "req-1", false)

    expect(invoke).toHaveBeenCalledWith("agent_stdin", {
      conversationId: "conv-1",
      data: expect.stringContaining('"behavior":"deny"'),
    })
  })

  it("stopChat invokes stop_agent and marks as not running", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp")
    expect(service.isRunning("conv-1")).toBe(true)

    await service.stopChat("conv-1")

    expect(invoke).toHaveBeenCalledWith("stop_agent", { conversationId: "conv-1" })
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

    await service.sendMessage("conv-1", "hello", "/tmp")
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

  it("attachListeners sets up stdout, stderr, and close listeners", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp")

    // Should have called listen 3 times for stdout, stderr, close
    expect(listen).toHaveBeenCalledWith("agent:stdout:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("agent:stderr:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("agent:close:conv-1", expect.any(Function))
  })

  it("handleOutput parses JSON lines and dispatches AgentEvents", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    // Capture the stdout listener callback
    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(stdoutHandler).not.toBeNull()

    // Simulate receiving a JSON line via stdout
    stdoutHandler!({
      payload:
        '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
    })

    // Should emit an AgentEvent of kind "message"
    expect(eventCallback).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "message", content: "hi" })
    )
  })

  it("handleOutput ignores non-JSON lines", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    stdoutHandler!({ payload: "not json at all" })

    // Should not call the event callback for non-JSON
    expect(eventCallback).not.toHaveBeenCalled()
  })

  it("handleOutput captures session_id from first event", async () => {
    const service = await freshService()

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    stdoutHandler!({
      payload: '{"type":"system","session_id":"sess-abc"}',
    })

    expect(service.getSessionId("conv-1")).toBe("sess-abc")
  })

  it("handleOutput emits toolApproval for Bash commands", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(stdoutHandler).not.toBeNull()

    // Simulate Bash tool approval request
    stdoutHandler!({
      payload: JSON.stringify({
        type: "control_request",
        request_id: "req-bash-1",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: { command: "cd /foo && pnpm install" },
        },
      }),
    })

    // Command prefixes are computed by ChatStore, not the service
    expect(eventCallback).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "req-bash-1",
      name: "Bash",
      input: { command: "cd /foo && pnpm install" },
      displayInput: '{\n  "command": "cd /foo && pnpm install"\n}',
    })
  })

  it("handleOutput emits toolApproval for non-Bash tools", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    stdoutHandler!({
      payload: JSON.stringify({
        type: "control_request",
        request_id: "req-read-1",
        request: {
          subtype: "can_use_tool",
          tool_name: "Read",
          input: { path: "/tmp/file.txt" },
        },
      }),
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "req-read-1",
      name: "Read",
      input: { path: "/tmp/file.txt" },
      displayInput: '{\n  "path": "/tmp/file.txt"\n}',
    })
  })

  it("handleOutput emits planApproval event with plan content for ExitPlanMode", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(stdoutHandler).not.toBeNull()

    const planContent = "# My Plan\n\n## Step 1\nDo something\n\n## Step 2\nDo something else"
    stdoutHandler!({
      payload: JSON.stringify({
        type: "control_request",
        request_id: "req-plan-1",
        request: {
          subtype: "can_use_tool",
          tool_name: "ExitPlanMode",
          input: { plan: planContent },
        },
      }),
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "planApproval",
      id: "req-plan-1",
      planContent: planContent,
    })
  })

  it("handleOutput emits planApproval with empty string when plan is missing", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    stdoutHandler!({
      payload: JSON.stringify({
        type: "control_request",
        request_id: "req-plan-2",
        request: {
          subtype: "can_use_tool",
          tool_name: "ExitPlanMode",
          input: {},
        },
      }),
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "planApproval",
      id: "req-plan-2",
      planContent: "",
    })
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    // listen is called first, then invoke for start_agent
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // stopChat
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Claude CLI not found/
    )
  })

  it("throws user-friendly error when spawn fails with ENOENT", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // stopChat
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: ENOENT"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Claude CLI not found/
    )
  })

  it("preserves original error message for non-spawn errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // stopChat
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Network timeout"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow("Network timeout")
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    // Reset modules to get fresh store instance
    vi.resetModules()

    // Re-mock before imports
    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // stopChat
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const { claudeAgentService } = await import("../claude")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    // Reset store state
    toolAvailabilityStore.claude = null

    try {
      await claudeAgentService.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.claude).not.toBeNull()
    expect(toolAvailabilityStore.claude!.available).toBe(false)
    expect(toolAvailabilityStore.claude!.error).toContain("command not found")
  })
})
