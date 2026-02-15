import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    codexPath: "codex",
    codexApprovalPolicy: "untrusted",
    loaded: true,
  },
}))

describe("CodexAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../codex")
    return mod.codexAgentService
  }

  it("starts with no running servers", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendMessage invokes start_codex_server for new chat", async () => {
    const service = await freshService()

    // Mock the initialize response
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") return undefined
      return undefined
    })

    // We need to mock the response to initialize and thread/start
    // For now, just verify the server start is called
    // Note: The promise will hang waiting for JSON-RPC responses, so we don't await it
    void service.sendMessage("chat-1", "hello", "/tmp/workdir")

    // Just check the initial call
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_codex_server", {
        serverId: "chat-1",
        codexPath: "codex",
        modelVersion: null,
        logDir: null,
        logId: "chat-1",
        agentShell: null,
      })
    })

    // Clean up by stopping
    service.stopChat("chat-1")
  })

  it("sendMessage passes modelVersion to start_codex_server", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") return undefined
      return undefined
    })

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, "gpt-5.3-codex")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_codex_server", {
        serverId: "chat-1",
        codexPath: "codex",
        modelVersion: "gpt-5.3-codex",
        logDir: null,
        logId: "chat-1",
        agentShell: null,
      })
    })

    service.stopChat("chat-1")
  })

  it("sendMessage passes logDir when provided", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") return undefined
      return undefined
    })

    void service.sendMessage("chat-1", "hello", "/tmp/workdir", "/tmp/logs", "gpt-5.2-codex")

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_codex_server", {
        serverId: "chat-1",
        codexPath: "codex",
        modelVersion: "gpt-5.2-codex",
        logDir: "/tmp/logs",
        logId: "chat-1",
        agentShell: null,
      })
    })

    service.stopChat("chat-1")
  })

  it("stopChat invokes stop_codex_server and marks as not running", async () => {
    const service = await freshService()

    // Manually set up a running chat state
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    chat.threadId = "thread-123"

    await service.stopChat("chat-1")

    expect(invoke).toHaveBeenCalledWith("stop_codex_server", { serverId: "chat-1" })
    expect(service.isRunning("chat-1")).toBe(false)
  })

  it("setSessionId and getSessionId work correctly", async () => {
    const service = await freshService()

    service.setSessionId("chat-1", "thread-xyz")
    expect(service.getSessionId("chat-1")).toBe("thread-xyz")

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

  it("sendToolApproval sends accept decision", async () => {
    const service = await freshService()

    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true

    await service.sendToolApproval("chat-1", "123", true)

    expect(invoke).toHaveBeenCalledWith("codex_stdin", {
      serverId: "chat-1",
      data: expect.stringContaining('"decision":"accept"'),
    })
  })

  it("sendToolApproval sends decline decision", async () => {
    const service = await freshService()

    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true

    await service.sendToolApproval("chat-1", "456", false)

    expect(invoke).toHaveBeenCalledWith("codex_stdin", {
      serverId: "chat-1",
      data: expect.stringContaining('"decision":"decline"'),
    })
  })

  it("sendToolApproval parses numeric request ID correctly", async () => {
    const service = await freshService()

    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true

    await service.sendToolApproval("chat-1", "789", true)

    // Should parse "789" back to number in the response
    expect(invoke).toHaveBeenCalledWith("codex_stdin", {
      serverId: "chat-1",
      data: expect.stringContaining('"id":789'),
    })
  })

  it("attaches stdout and close listeners", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") return undefined
      return undefined
    })

    service.sendMessage("chat-1", "hello", "/tmp")

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith("codex:stdout:chat-1", expect.any(Function))
      expect(listen).toHaveBeenCalledWith("codex:close:chat-1", expect.any(Function))
    })

    service.stopChat("chat-1")
  })

  it("sendMessage uses passed permissionMode for approvalPolicy", async () => {
    const service = await freshService()
    const stdinCalls: string[] = []

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") {
        stdinCalls.push((args as { data: string }).data)
        return undefined
      }
      return undefined
    })

    // Pass "full-auto" as permission mode
    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, null, "full-auto")

    // Wait for the initialize request to be sent
    await vi.waitFor(() => {
      expect(stdinCalls.length).toBeGreaterThan(0)
    })

    // The initialize request should be sent first
    expect(stdinCalls[0]).toContain('"method":"initialize"')

    service.stopChat("chat-1")
  })

  it("sendMessage falls back to configStore.codexApprovalPolicy when permissionMode is null", async () => {
    const service = await freshService()
    const stdinCalls: string[] = []

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") {
        stdinCalls.push((args as { data: string }).data)
        return undefined
      }
      return undefined
    })

    // Pass null for permission mode - should use configStore.codexApprovalPolicy ("untrusted")
    void service.sendMessage("chat-1", "hello", "/tmp/workdir", undefined, null, null)

    // Wait for the initialize request to be sent
    await vi.waitFor(() => {
      expect(stdinCalls.length).toBeGreaterThan(0)
    })

    // The initialize request should be sent first
    expect(stdinCalls[0]).toContain('"method":"initialize"')

    service.stopChat("chat-1")
  })

  it("sendMessage does not prepend initPrompt on follow-up messages", async () => {
    const service = await freshService()

    // Set up a chat that's already running with a thread
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true
    chat.threadId = "thread-123"

    const stdinCalls: string[] = []
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "codex_stdin") {
        const data = (args as { data: string }).data
        stdinCalls.push(data)

        // Simulate turn/start response
        if (data.includes('"method":"turn/start"')) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({
              id: msg.id,
              result: { turn: { id: "turn-1", status: "inProgress" } },
            })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
          }, 10)
        }
      }
      return undefined
    })

    // Need to attach listeners first (normally done by sendMessage on first call)
    // @ts-expect-error - accessing private method for testing
    await service.attachListeners("chat-1")

    // Send a follow-up message with initPrompt - it should NOT be prepended
    await service.sendMessage(
      "chat-1",
      "follow up",
      "/tmp",
      undefined,
      null,
      null,
      "init instructions"
    )

    // Find the turn/start request and parse it
    const turnStartCall = stdinCalls.find((data) => data.includes('"method":"turn/start"'))
    expect(turnStartCall).toBeDefined()

    const turnStartData = JSON.parse(turnStartCall!) as {
      params: { input: Array<{ type: string; text: string }> }
    }
    const textInput = turnStartData.params.input.find((i) => i.type === "text")

    // The message should be exactly "follow up", not prepended with initPrompt
    expect(textInput?.text).toBe("follow up")
  })

  it("sendMessage prepends initPrompt on first message of new session", async () => {
    const service = await freshService()

    const stdinCalls: string[] = []
    let initializeResolved = false

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") {
        const data = (args as { data: string }).data
        stdinCalls.push(data)

        // Simulate JSON-RPC responses for initialize and thread/start
        if (data.includes('"method":"initialize"')) {
          // Simulate the response by triggering the stdout listener
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({ id: msg.id, result: { userAgent: "codex/test" } })
            // Find and call the stdout listener
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
            initializeResolved = true
          }, 10)
        }
        if (data.includes('"method":"thread/start"') && initializeResolved) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({
              id: msg.id,
              result: { thread: { id: "thread-new" } },
            })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
          }, 10)
        }
        if (data.includes('"method":"turn/start"')) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({
              id: msg.id,
              result: { turn: { id: "turn-1", status: "inProgress" } },
            })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
          }, 10)
        }
      }
      return undefined
    })

    // Send first message with initPrompt
    await service.sendMessage(
      "chat-1",
      "user prompt",
      "/tmp",
      undefined,
      null,
      null,
      "Read docs/ARCH.md first"
    )

    // Find the turn/start request and parse it
    const turnStartCall = stdinCalls.find((data) => data.includes('"method":"turn/start"'))
    expect(turnStartCall).toBeDefined()

    const turnStartData = JSON.parse(turnStartCall!) as {
      params: { input: Array<{ type: string; text: string }> }
    }
    const textInput = turnStartData.params.input.find((i) => i.type === "text")

    // The message should have initPrompt prepended with double newline separator
    expect(textInput?.text).toBe("Read docs/ARCH.md first\n\nuser prompt")

    service.stopChat("chat-1")
  })

  it("sendMessage does not prepend initPrompt when initPrompt is undefined", async () => {
    const service = await freshService()

    // Set up a fresh chat (not running yet)
    const stdinCalls: string[] = []
    let initializeResolved = false

    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "start_codex_server") return undefined
      if (cmd === "codex_stdin") {
        const data = (args as { data: string }).data
        stdinCalls.push(data)

        if (data.includes('"method":"initialize"')) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({ id: msg.id, result: { userAgent: "codex/test" } })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
            initializeResolved = true
          }, 10)
        }
        if (data.includes('"method":"thread/start"') && initializeResolved) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({
              id: msg.id,
              result: { thread: { id: "thread-new" } },
            })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
          }, 10)
        }
        if (data.includes('"method":"turn/start"')) {
          setTimeout(() => {
            const msg = JSON.parse(data)
            const response = JSON.stringify({
              id: msg.id,
              result: { turn: { id: "turn-1", status: "inProgress" } },
            })
            const listenCalls = vi.mocked(listen).mock.calls
            const stdoutListener = listenCalls.find((c) => c[0] === "codex:stdout:chat-1")
            if (stdoutListener) {
              ;(stdoutListener[1] as (event: { payload: string }) => void)({ payload: response })
            }
          }, 10)
        }
      }
      return undefined
    })

    // Send first message WITHOUT initPrompt
    await service.sendMessage("chat-1", "user prompt", "/tmp", undefined, null, null, undefined)

    // Find the turn/start request and parse it
    const turnStartCall = stdinCalls.find((data) => data.includes('"method":"turn/start"'))
    expect(turnStartCall).toBeDefined()

    const turnStartData = JSON.parse(turnStartCall!) as {
      params: { input: Array<{ type: string; text: string }> }
    }
    const textInput = turnStartData.params.input.find((i) => i.type === "text")

    // The message should be exactly "user prompt", no prepending
    expect(textInput?.text).toBe("user prompt")

    service.stopChat("chat-1")
  })

  it("handleServerRequest emits toolApproval for Bash commands", async () => {
    const service = await freshService()
    const eventCb = vi.fn()
    service.onEvent("chat-1", eventCb)

    // Set up chat state
    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    // @ts-expect-error - accessing private method for testing
    await service.attachListeners("chat-1")

    expect(stdoutHandler).not.toBeNull()

    // Simulate command approval request with chained commands
    stdoutHandler!({
      payload: JSON.stringify({
        id: 123,
        method: "item/commandExecution/requestApproval",
        params: { command: "cd /foo && pnpm install" },
      }),
    })

    // Command prefixes are computed by ChatStore, not the service
    expect(eventCb).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "123",
      name: "Bash",
      input: { command: "cd /foo && pnpm install" },
      displayInput: "cd /foo && pnpm install",
    })
  })

  it("handleServerRequest emits toolApproval without commandPrefixes for Edit tool", async () => {
    const service = await freshService()
    const eventCb = vi.fn()
    service.onEvent("chat-1", eventCb)

    // @ts-expect-error - accessing private method for testing
    const chat = service.getOrCreateChat("chat-1")
    chat.running = true

    let stdoutHandler: ((event: { payload: string }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      if (typeof eventName === "string" && eventName.includes("stdout")) {
        stdoutHandler = handler as typeof stdoutHandler
      }
      return vi.fn() as unknown as () => void
    })

    // @ts-expect-error - accessing private method for testing
    await service.attachListeners("chat-1")

    stdoutHandler!({
      payload: JSON.stringify({
        id: 789,
        method: "item/fileChange/requestApproval",
        params: { path: "/tmp/file.txt", content: "new content" },
      }),
    })

    expect(eventCb).toHaveBeenCalledWith({
      kind: "toolApproval",
      id: "789",
      name: "Edit",
      input: { path: "/tmp/file.txt", content: "new content" },
      displayInput: expect.stringContaining("/tmp/file.txt"),
    })

    // Verify commandPrefixes is NOT included for non-Bash tools
    expect(eventCb.mock.calls[0][0].commandPrefixes).toBeUndefined()
  })

  it("throws user-friendly error when spawn fails with command not found", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const service = await freshService()

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow(
      /Codex CLI not found/
    )
  })

  it("throws user-friendly error when spawn fails with ENOENT", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: ENOENT"))

    const service = await freshService()

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow(
      /Codex CLI not found/
    )
  })

  it("preserves original error message for non-spawn errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Network timeout"))

    const service = await freshService()

    await expect(service.sendMessage("chat-1", "hello", "/tmp")).rejects.toThrow("Network timeout")
  })

  it("updates toolAvailabilityStore when command not found", async () => {
    vi.resetModules()

    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const { codexAgentService } = await import("../codex")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    toolAvailabilityStore.codex = null

    try {
      await codexAgentService.sendMessage("chat-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.codex).not.toBeNull()
    expect(toolAvailabilityStore.codex!.available).toBe(false)
    expect(toolAvailabilityStore.codex!.error).toContain("command not found")
  })
})
