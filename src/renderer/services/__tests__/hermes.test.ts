import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore to avoid async load side effects
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    hermesPath: "hermes",
    agentShell: "",
    loaded: true,
    setHermesModels: vi.fn(),
  },
}))

describe("HermesAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../hermes")
    return mod.hermesAgentService
  }

  it("starts with no running conversations", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendToolApproval sends allow_once response with jsonrpc field", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "10", true, { command: "ls" })

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "hermes_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.jsonrpc).toBe("2.0")
    expect(data.result.outcome.outcome).toBe("selected")
    expect(data.result.outcome.optionId).toBe("allow_once")
  })

  it("sendToolApproval denial sends Hermes's deny option id (not reject_once)", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "10", false)

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "hermes_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.result.outcome.outcome).toBe("selected")
    expect(data.result.outcome.optionId).toBe("deny")
  })

  it("sendToolApproval handles numeric request IDs", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.sendToolApproval("conv-1", "42", true)

    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "hermes_stdin")
    expect(call).toBeDefined()
    const data = JSON.parse((call![1] as { data: string }).data)
    expect(data.id).toBe(42) // Should be a number, not "42"
  })

  it("interruptTurn sends session/cancel but does NOT kill the server", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.interruptTurn("conv-1")

    expect(invoke).toHaveBeenCalledWith("hermes_stdin", {
      serverId: "conv-1",
      data: expect.stringContaining("session/cancel"),
    })
    expect(invoke).not.toHaveBeenCalledWith("stop_hermes_server", expect.anything())
  })

  it("stopChat interrupts turn then kills server", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "sess-123")

    await service.stopChat("conv-1")

    expect(invoke).toHaveBeenCalledWith("hermes_stdin", {
      serverId: "conv-1",
      data: expect.stringContaining("session/cancel"),
    })
    expect(invoke).toHaveBeenCalledWith("stop_hermes_server", { serverId: "conv-1" })
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

  it("throws user-friendly error when spawn fails with command not found", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Failed to spawn: command not found"))

    const service = await freshService()

    await expect(service.sendMessage("conv-1", "hello", "/tmp")).rejects.toThrow(
      /Hermes CLI not found/
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

    const { hermesAgentService } = await import("../hermes")
    const { toolAvailabilityStore } = await import("../../stores/ToolAvailabilityStore")

    toolAvailabilityStore.hermes = null

    try {
      await hermesAgentService.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected to throw
    }

    expect(toolAvailabilityStore.hermes).not.toBeNull()
    expect(toolAvailabilityStore.hermes!.available).toBe(false)
    expect(toolAvailabilityStore.hermes!.error).toContain("command not found")
  })

  it("attaches stdout, event, and close listeners when starting server", async () => {
    const service = await freshService()

    vi.mocked(invoke).mockRejectedValueOnce(new Error("stop early"))

    try {
      await service.sendMessage("conv-1", "hello", "/tmp")
    } catch {
      // Expected
    }

    expect(listen).toHaveBeenCalledWith("hermes:stdout:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("hermes:event:conv-1", expect.any(Function))
    expect(listen).toHaveBeenCalledWith("hermes:close:conv-1", expect.any(Function))
  })

  describe("session flow", () => {
    /**
     * Full-conversation harness: captures the stdout listener and answers
     * every JSON-RPC request the service writes to hermes_stdin, so
     * sendMessage can run end to end. `respond` maps a request method to
     * its response body ({ result } or { error }).
     */
    async function setupConversation(
      respond: (method: string, params: Record<string, unknown>) => Record<string, unknown>
    ) {
      let stdoutHandler: ((event: { payload: string }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).startsWith("hermes:stdout:")) {
          stdoutHandler = handler as (event: { payload: string }) => void
        }
        return () => {}
      })

      vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        if (cmd === "hermes_stdin") {
          const msg = JSON.parse((args as { data: string }).data)
          if (msg.method && msg.id !== undefined) {
            const body = respond(msg.method, msg.params)
            queueMicrotask(() => {
              stdoutHandler?.({
                payload: JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }),
              })
            })
          }
        }
        return undefined
      })

      vi.resetModules()
      const { hermesAgentService } = await import("../hermes")
      const { configStore } = await import("../../stores/ConfigStore")

      const eventCb = vi.fn()
      hermesAgentService.onEvent("conv-1", eventCb)

      return { service: hermesAgentService, eventCb, configStore }
    }

    /** Requests written to hermes_stdin, in order, parsed. */
    function stdinRequests(): Array<{ method?: string; params?: Record<string, unknown> }> {
      return vi
        .mocked(invoke)
        .mock.calls.filter((c) => c[0] === "hermes_stdin")
        .map((c) => JSON.parse((c[1] as { data: string }).data))
    }

    /** Invoke call summaries for order assertions. */
    function invokeSummaries(): string[] {
      return vi.mocked(invoke).mock.calls.map((c) => {
        if (c[0] === "hermes_stdin") {
          const msg = JSON.parse((c[1] as { data: string }).data)
          return `stdin:${msg.method ?? "response"}`
        }
        if (c[0] === "hermes_set_replay_suppression") {
          return `suppress:${(c[1] as { suppress: boolean }).suppress}`
        }
        return String(c[0])
      })
    }

    const MODELS_RESULT = {
      models: {
        availableModels: [
          { modelId: "nous:hermes-4-405b", name: "Hermes 4 405B" },
          { modelId: "openrouter:qwen3-coder", name: "Qwen3 Coder" },
        ],
        currentModelId: "nous:hermes-4-405b",
      },
    }

    it("first message creates a session, emits sessionId, and caches models", async () => {
      const { service, eventCb, configStore } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: true } } }
          case "session/new":
            return { result: { sessionId: "sess-new-1", ...MODELS_RESULT } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      await service.sendMessage("conv-1", "hello", "/tmp/project")

      expect(eventCb).toHaveBeenCalledWith({ kind: "sessionId", sessionId: "sess-new-1" })
      expect(eventCb).toHaveBeenCalledWith({ kind: "turnComplete" })
      expect(configStore.setHermesModels).toHaveBeenCalledWith([
        { alias: "nous:hermes-4-405b", displayName: "Hermes 4 405B" },
        { alias: "openrouter:qwen3-coder", displayName: "Qwen3 Coder" },
      ])

      // No resume machinery on a fresh chat
      expect(invoke).not.toHaveBeenCalledWith("hermes_set_replay_suppression", expect.anything())
      expect(stdinRequests().some((r) => r.method === "session/load")).toBe(false)
    })

    it("resumes a persisted session via session/load with suppression around it", async () => {
      const { service } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: true } } }
          case "session/load":
            return { result: { ...MODELS_RESULT } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      // Session id restored from chat metadata (app restart)
      service.setSessionId("conv-1", "sess-persisted")

      await service.sendMessage("conv-1", "continue please", "/tmp/project")

      const order = invokeSummaries()
      const suppressOn = order.indexOf("suppress:true")
      const load = order.indexOf("stdin:session/load")
      const suppressOff = order.indexOf("suppress:false")
      const promptIdx = order.indexOf("stdin:session/prompt")

      expect(suppressOn).toBeGreaterThanOrEqual(0)
      expect(load).toBeGreaterThan(suppressOn)
      expect(suppressOff).toBeGreaterThan(load)
      expect(promptIdx).toBeGreaterThan(suppressOff)

      // Resumed — no new session created
      expect(order).not.toContain("stdin:session/new")

      const loadReq = stdinRequests().find((r) => r.method === "session/load")
      expect(loadReq?.params).toEqual({ cwd: "/tmp/project", sessionId: "sess-persisted" })

      const promptReq = stdinRequests().find((r) => r.method === "session/prompt")
      expect(promptReq?.params?.sessionId).toBe("sess-persisted")
    })

    it("discards the persisted session id when the agent does not support loadSession", async () => {
      // codex-review.md finding 1: with loadSession absent/false, the stale id
      // used to survive, skip session/new, and session/prompt then targeted a
      // session unknown to the fresh process.
      const { service, eventCb } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: {} } }
          case "session/new":
            return { result: { sessionId: "sess-replacement" } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      service.setSessionId("conv-1", "sess-persisted")

      await service.sendMessage("conv-1", "hello", "/tmp/project")

      const order = invokeSummaries()
      expect(order).not.toContain("stdin:session/load")
      expect(order).toContain("stdin:session/new")
      expect(eventCb).toHaveBeenCalledWith({ kind: "sessionId", sessionId: "sess-replacement" })

      const promptReq = stdinRequests().find((r) => r.method === "session/prompt")
      expect(promptReq?.params?.sessionId).toBe("sess-replacement")
    })

    it("falls back to session/new when session/load fails, clearing suppression", async () => {
      const { service, eventCb } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: true } } }
          case "session/load":
            return { error: { code: -32000, message: "session not found" } }
          case "session/new":
            return { result: { sessionId: "sess-fresh", ...MODELS_RESULT } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      service.setSessionId("conv-1", "sess-gone")

      await service.sendMessage("conv-1", "hello again", "/tmp/project")

      const order = invokeSummaries()
      // Suppression cleared despite the load error
      expect(order.indexOf("suppress:false")).toBeGreaterThan(order.indexOf("suppress:true"))
      // Fell back to a fresh session and persisted the new id
      expect(order).toContain("stdin:session/new")
      expect(eventCb).toHaveBeenCalledWith({ kind: "sessionId", sessionId: "sess-fresh" })
      expect(service.getSessionId("conv-1")).toBe("sess-fresh")
    })

    it("sends session/set_model only when the requested model differs from the session's", async () => {
      const { service } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: false } } }
          case "session/new":
            return { result: { sessionId: "sess-1", ...MODELS_RESULT } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      // Session's current model is nous:hermes-4-405b; request the same one
      await service.sendMessage("conv-1", "hi", "/tmp/project", undefined, "nous:hermes-4-405b")
      expect(stdinRequests().some((r) => r.method === "session/set_model")).toBe(false)

      // Now switch mid-chat
      await service.sendMessage("conv-1", "hi", "/tmp/project", undefined, "openrouter:qwen3-coder")
      const setModel = stdinRequests().find((r) => r.method === "session/set_model")
      expect(setModel?.params).toEqual({
        sessionId: "sess-1",
        modelId: "openrouter:qwen3-coder",
      })
    })

    it("prepends initPrompt only when a brand-new session was created", async () => {
      const { service } = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: true } } }
          case "session/load":
            return { result: {} }
          case "session/new":
            return { result: { sessionId: "sess-1" } }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })

      // Fresh chat: initPrompt prepended
      await service.sendMessage(
        "conv-1",
        "first message",
        "/tmp/project",
        undefined,
        undefined,
        undefined,
        "Project rules: be terse."
      )
      let promptReq = stdinRequests().find((r) => r.method === "session/prompt")
      const firstText = (promptReq?.params?.prompt as Array<{ text: string }>)[0].text
      expect(firstText).toContain("Project rules: be terse.")
      expect(firstText).toContain("first message")

      // Simulate app restart: fresh service, resumed session
      vi.clearAllMocks()
      const resumed = await setupConversation((method) => {
        switch (method) {
          case "initialize":
            return { result: { agentCapabilities: { loadSession: true } } }
          case "session/load":
            return { result: {} }
          case "session/prompt":
            return { result: { stopReason: "end_turn" } }
          default:
            return { result: {} }
        }
      })
      resumed.service.setSessionId("conv-1", "sess-1")

      await resumed.service.sendMessage(
        "conv-1",
        "follow-up",
        "/tmp/project",
        undefined,
        undefined,
        undefined,
        "Project rules: be terse."
      )
      promptReq = stdinRequests().find((r) => r.method === "session/prompt")
      const resumedText = (promptReq?.params?.prompt as Array<{ text: string }>)[0].text
      expect(resumedText).toBe("follow-up")
    })
  })

  describe("Rust event handling", () => {
    async function setupWithEventCapture() {
      let eventHandler: ((event: { payload: unknown }) => void) | null = null

      vi.mocked(listen).mockImplementation(async (eventName, handler) => {
        if ((eventName as string).includes("hermes:event:")) {
          eventHandler = handler as (event: { payload: unknown }) => void
        }
        return () => {}
      })

      vi.resetModules()
      const { hermesAgentService } = await import("../hermes")

      const eventCb = vi.fn()
      hermesAgentService.onEvent("conv-1", eventCb)

      vi.mocked(invoke).mockRejectedValueOnce(new Error("stop"))
      try {
        await hermesAgentService.sendMessage("conv-1", "test", "/tmp")
      } catch {
        // Expected
      }

      return { service: hermesAgentService, eventCb, eventHandler: eventHandler! }
    }

    it("handles Rust Text event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "text", text: "Hello world" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "text", text: "Hello world" })
    })

    it("handles Rust ToolApproval event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

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
        isProcessed: false,
      })
    })

    it("skips auto-approved ToolApproval events", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

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

      expect(eventCb).not.toHaveBeenCalled()
    })

    it("handles Rust BashOutput event", async () => {
      const { eventCb, eventHandler } = await setupWithEventCapture()

      eventHandler({ payload: { kind: "bashOutput", text: "file.txt\n" } })

      expect(eventCb).toHaveBeenCalledWith({ kind: "bashOutput", text: "file.txt\n" })
    })
  })
})
