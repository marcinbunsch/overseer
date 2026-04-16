import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    piPath: "pi",
    agentShell: "",
    loaded: true,
  },
}))

describe("PiAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../pi")
    return mod.piAgentService
  }

  it("starts with no running chats", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendMessage invokes start_pi_server on first call", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_pi_server", {
        serverId: "chat-1",
        piPath: "pi",
        workingDir: "/tmp/workdir",
        logDir: null,
        logId: "chat-1",
        agentShell: null,
      })
    })

    // Should also send a prompt command via stdin
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pi_stdin", {
        serverId: "chat-1",
        data: expect.stringContaining('"type":"prompt"'),
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage sends prompt via stdin on subsequent calls (reuses server)", async () => {
    const service = await freshService()

    // First message starts the server
    await service.sendMessage("chat-1", "hello", "/tmp/workdir")

    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)

    // Second message should NOT start a new server
    await service.sendMessage("chat-1", "follow up", "/tmp/workdir")

    expect(invoke).not.toHaveBeenCalledWith("start_pi_server", expect.anything())
    expect(invoke).toHaveBeenCalledWith("pi_stdin", {
      serverId: "chat-1",
      data: expect.stringContaining('"follow up"'),
    })

    service.stopChat("chat-1")
  })

  it("sendMessage passes logDir when provided", async () => {
    const service = await freshService()

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", "/tmp/logs")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_pi_server", {
        serverId: "chat-1",
        piPath: "pi",
        workingDir: "/tmp/workdir",
        logDir: "/tmp/logs",
        logId: "chat-1",
        agentShell: null,
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage sets model via set_model command when modelVersion provided", async () => {
    const service = await freshService()

    // Aliases are "provider/modelId"; the first slash is the separator.
    void service.sendMessage(
      "chat-1",
      "hello",
      "/tmp/workdir",
      undefined,
      "anthropic/claude-sonnet-4-5"
    )

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pi_stdin", {
        serverId: "chat-1",
        data: expect.stringMatching(
          /"type":"set_model".*"provider":"anthropic".*"modelId":"claude-sonnet-4-5"/
        ),
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage splits provider from modelId on the first slash only", async () => {
    const service = await freshService()

    // Ollama model IDs can themselves contain "/", so the split must only
    // consume the first slash (the provider separator).
    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, "ollama/qwen/qwen3.5-9b")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pi_stdin", {
        serverId: "chat-1",
        data: expect.stringMatching(
          /"type":"set_model".*"provider":"ollama".*"modelId":"qwen\/qwen3\.5-9b"/
        ),
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage prepends initPrompt on first message", async () => {
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
      expect(invoke).toHaveBeenCalledWith("pi_stdin", {
        serverId: "chat-1",
        data: expect.stringContaining("Read docs/ARCH.md first\\n\\nuser prompt"),
      })
    })

    service.stopChat("chat-1")
  })

  it("stopChat invokes stop_pi_server and marks as not running", async () => {
    const service = await freshService()

    // Set up a running chat
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    chat.serverStarted = true

    await service.stopChat("chat-1")

    expect(invoke).toHaveBeenCalledWith("stop_pi_server", { serverId: "chat-1" })
    expect(service.isRunning("chat-1")).toBe(false)
  })

  it("interruptTurn sends abort command", async () => {
    const service = await freshService()

    // Set up a running server
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    chat.serverStarted = true

    await service.interruptTurn("chat-1")

    expect(invoke).toHaveBeenCalledWith("pi_stdin", {
      serverId: "chat-1",
      data: expect.stringContaining('"abort"'),
    })
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
  })

  it("onEvent and onDone register callbacks", async () => {
    const service = await freshService()

    const eventCb = vi.fn()
    const doneCb = vi.fn()

    service.onEvent("chat-1", eventCb)
    service.onDone("chat-1", doneCb)

    expect(() => service.onEvent("chat-1", eventCb)).not.toThrow()
    expect(() => service.onDone("chat-1", doneCb)).not.toThrow()
  })

  it("sendToolApproval is a no-op (doesn't throw)", async () => {
    const service = await freshService()

    await expect(service.sendToolApproval("chat-1", "123", true)).resolves.toBeUndefined()
    await expect(service.sendToolApproval("chat-1", "456", false)).resolves.toBeUndefined()
  })

  it("attaches event, stderr, and close listeners", async () => {
    const service = await freshService()

    service.sendMessage("chat-1", "hello", "/tmp")

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith("pi:event:chat-1", expect.any(Function))
      expect(listen).toHaveBeenCalledWith("pi:stderr:chat-1", expect.any(Function))
      expect(listen).toHaveBeenCalledWith("pi:close:chat-1", expect.any(Function))
    })

    service.stopChat("chat-1")
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_pi_server") throw new Error("Failed to spawn: command not found")
      return undefined
    })

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow(/Pi CLI not found/)
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    vi.resetModules()

    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_pi_server") throw new Error("Failed to spawn: command not found")
      return undefined
    })

    const { piAgentService } = await import("../pi")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    toolAvailabilityStore.pi = null

    try {
      await piAgentService.sendMessage("chat-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.pi).not.toBeNull()
    expect(toolAvailabilityStore.pi!.available).toBe(false)
    expect(toolAvailabilityStore.pi!.error).toContain("command not found")
  })

  describe("Rust event handling", () => {
    async function setupWithEventCapture() {
      let eventHandler: ((event: { payload: unknown }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).includes("pi:event:")) {
          eventHandler = handler as (event: { payload: unknown }) => void
        }
        return () => {}
      })

      vi.resetModules()
      const { piAgentService } = await import("../pi")

      const eventCb = vi.fn()
      piAgentService.onEvent("chat-1", eventCb)

      await piAgentService.sendMessage("chat-1", "test", "/tmp")

      return { service: piAgentService, eventCb, eventHandler: eventHandler! }
    }

    it("handles Rust Text event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "text", text: "Hello world" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "text", text: "Hello world" })
    })

    it("handles Rust Message event with tool meta", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({
        payload: {
          kind: "message",
          content: '[Bash]\n{"command": "git status"}',
          tool_meta: { tool_name: "Bash" },
        },
      })

      expect(eventCb).toHaveBeenCalledWith({
        kind: "message",
        content: '[Bash]\n{"command": "git status"}',
        toolMeta: { toolName: "Bash", linesAdded: undefined, linesRemoved: undefined },
        parentToolUseId: undefined,
        toolUseId: undefined,
        isInfo: undefined,
      })
    })

    it("handles Rust BashOutput event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({
        payload: { kind: "bashOutput", text: "file.txt\n" },
      })

      expect(eventCb).toHaveBeenCalledWith({ kind: "bashOutput", text: "file.txt\n" })
    })

    it("handles Rust TurnComplete event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "turnComplete" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "turnComplete" })
    })

    it("handles Rust Done event", async () => {
      const { service, eventCb, eventHandler } = await setupWithEventCapture()
      const doneCb = vi.fn()
      service.onDone("chat-1", doneCb)

      eventHandler({ payload: { kind: "done" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "done" })
      // Pi's RPC process is persistent — agent_end (→ done) ends the prompt
      // cycle, so we must fire the done callback to clear the UI "sending"
      // state and flip isRunning off.
      expect(doneCb).toHaveBeenCalledTimes(1)
      expect(service.isRunning("chat-1")).toBe(false)
    })

    it("logs warning for unknown event kinds", async () => {
      const { eventHandler } = await setupWithEventCapture()
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

      eventHandler({ payload: { kind: "unknownEventType" } })

      expect(consoleWarn).toHaveBeenCalledWith("Unknown Pi event kind: unknownEventType")
      consoleWarn.mockRestore()
    })
  })
})
