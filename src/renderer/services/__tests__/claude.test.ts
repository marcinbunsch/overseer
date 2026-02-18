import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore to avoid async load side effects
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    claudePath: "claude",
    agentShell: null,
    loaded: true,
  },
}))

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

  it("sendMessage invokes send_message for new conversation", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp/workdir")

    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
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

  it("sendMessage passes modelVersion to send_message", async () => {
    const service = await freshService()

    await service.sendMessage("conv-1", "hello", "/tmp/workdir", undefined, "opus")

    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
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

    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
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

  it("sendMessage prepends initPrompt to prompt when no sessionId yet", async () => {
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

    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
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

  it("sendMessage does NOT prepend initPrompt when sessionId exists", async () => {
    const service = await freshService()

    // Set session ID first (simulating resumed session)
    service.setSessionId("conv-1", "session-abc")

    await service.sendMessage(
      "conv-1",
      "hello",
      "/tmp/workdir",
      undefined,
      null,
      null,
      "Read docs/ARCH.md first"
    )

    // initPrompt should NOT be prepended since we have a sessionId
    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
      prompt: "hello", // No initPrompt prepended
      workingDir: "/tmp/workdir",
      agentPath: "claude",
      sessionId: "session-abc",
      modelVersion: null,
      logDir: null,
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
    })
  })

  it("sendMessage calls send_message for follow-up (backend decides start vs stdin)", async () => {
    const service = await freshService()

    // Start first message
    await service.sendMessage("conv-1", "first", "/tmp")

    // Manually set session ID (normally comes from event)
    service.setSessionId("conv-1", "session-abc")

    // Clear mocks to check only follow-up call
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)

    // Send follow-up - backend now decides whether to start new or use stdin
    await service.sendMessage("conv-1", "follow up", "/tmp")

    // Backend handles the start-vs-stdin logic now
    expect(invoke).toHaveBeenCalledWith("send_message", {
      conversationId: "conv-1",
      projectName: "",
      prompt: "follow up",
      workingDir: "/tmp",
      agentPath: "claude",
      sessionId: "session-abc",
      modelVersion: null,
      logDir: null,
      logId: "conv-1",
      permissionMode: null,
      agentShell: null,
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

    // Should have called listen 4 times for stdout, stderr, event, close
    expect(listen).toHaveBeenCalledWith("agent:stdout:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("agent:stderr:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("agent:event:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("agent:close:conv-1", expect.any(Function))
  })

  it("handleBackendEvent dispatches AgentEvents from Rust parser", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    // Capture the agent event listener callback
    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(eventHandler).not.toBeNull()

    // Simulate receiving a parsed agent event
    eventHandler!({
      payload: {
        kind: "message",
        content: "hi",
      },
    })

    // Should emit an AgentEvent of kind "message"
    expect(eventCallback).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "message", content: "hi" })
    )
  })

  it("maps question events from Rust to frontend shape", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    eventHandler!({
      payload: {
        kind: "question",
        request_id: "req-1",
        questions: [
          {
            question: "Pick one",
            header: "Choice",
            options: [{ label: "A", description: "Option A" }],
            multi_select: false,
          },
        ],
        raw_input: { questions: [] },
      },
    })

    expect(eventCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "question",
        id: "req-1",
        questions: [
          expect.objectContaining({
            multiSelect: false,
          }),
        ],
      })
    )
  })

  it("handles sessionId events from Rust parser", async () => {
    const service = await freshService()

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    eventHandler!({
      payload: { kind: "sessionId", session_id: "sess-abc" },
    })

    expect(service.getSessionId("conv-1")).toBe("sess-abc")
  })

  it("handles toolApproval events for Bash commands from Rust parser", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(eventHandler).not.toBeNull()

    eventHandler!({
      payload: {
        kind: "toolApproval",
        request_id: "req-bash-1",
        name: "Bash",
        input: { command: "cd /foo && pnpm install" },
        display_input: "cd /foo && pnpm install",
      },
    })

    // Command prefixes are computed by ChatStore, not the service
    expect(eventCallback).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "req-bash-1",
      name: "Bash",
      input: { command: "cd /foo && pnpm install" },
      displayInput: "cd /foo && pnpm install",
      commandPrefixes: undefined,
      autoApproved: false,
      isProcessed: false,
    })
  })

  it("handles toolApproval events for non-Bash tools from Rust parser", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    eventHandler!({
      payload: {
        kind: "toolApproval",
        request_id: "req-read-1",
        name: "Read",
        input: { path: "/tmp/file.txt" },
        display_input: '{"path":"/tmp/file.txt"}',
      },
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "req-read-1",
      name: "Read",
      input: { path: "/tmp/file.txt" },
      displayInput: '{"path":"/tmp/file.txt"}',
      commandPrefixes: undefined,
      autoApproved: false,
      isProcessed: false,
    })
  })

  it("handles planApproval event with plan content for ExitPlanMode", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    expect(eventHandler).not.toBeNull()

    const planContent = "# My Plan\n\n## Step 1\nDo something\n\n## Step 2\nDo something else"
    eventHandler!({
      payload: {
        kind: "planApproval",
        request_id: "req-plan-1",
        content: planContent,
      },
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "planApproval",
      id: "req-plan-1",
      planContent: planContent,
      isProcessed: false,
    })
  })

  it("handles planApproval with empty string when plan is missing", async () => {
    const service = await freshService()
    const eventCallback = vi.fn()
    service.onEvent("conv-1", eventCallback)

    let eventHandler:
      | ((event: { payload: { kind: string; [key: string]: unknown } }) => void)
      | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("agent:event")) {
        eventHandler = handler as typeof eventHandler
      }
      return vi.fn() as unknown as () => void
    })

    await service.sendMessage("conv-1", "hello", "/tmp")

    eventHandler!({
      payload: {
        kind: "planApproval",
        request_id: "req-plan-2",
        content: "",
      },
    })

    expect(eventCallback).toHaveBeenCalledWith({
      kind: "planApproval",
      id: "req-plan-2",
      planContent: "",
      isProcessed: false,
    })
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    // send_message fails with command not found
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Claude CLI not found/
    )
  })

  it("throws user-friendly error when spawn fails with ENOENT", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: ENOENT"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Claude CLI not found/
    )
  })

  it("preserves original error message for non-spawn errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Network timeout"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow("Network timeout")
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    // Reset modules to get fresh store instance
    vi.resetModules()

    // Re-mock before imports
    vi.mocked(listen).mockResolvedValue(vi.fn())
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
