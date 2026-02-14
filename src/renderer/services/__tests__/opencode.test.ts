import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

// Mock ConfigStore
vi.mock("../../stores/ConfigStore", () => ({
  configStore: {
    opencodePath: "opencode",
    loaded: true,
  },
}))

// Mock ToolAvailabilityStore
vi.mock("../../stores/ToolAvailabilityStore", () => ({
  toolAvailabilityStore: {
    opencode: null,
    markUnavailable: vi.fn(),
  },
}))

// Mock the SDK
const mockHealthy = vi.fn().mockResolvedValue({ data: { healthy: true } })
const mockSessionCreate = vi.fn().mockResolvedValue({ data: { id: "session-123" } })
const mockSessionPrompt = vi.fn().mockResolvedValue({ data: {} })
const mockSessionAbort = vi.fn().mockResolvedValue({ data: {} })
const mockGlobalEvent = vi.fn().mockResolvedValue({
  stream: (async function* () {
    // Empty async generator
  })(),
})

vi.mock("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: vi.fn(() => ({
    global: {
      health: mockHealthy,
      event: mockGlobalEvent,
    },
    session: {
      create: mockSessionCreate,
      prompt: mockSessionPrompt,
      abort: mockSessionAbort,
    },
  })),
}))

describe("OpenCodeAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
    // listen returns an unlisten function
    vi.mocked(listen).mockResolvedValue(vi.fn())
    // Reset SDK mocks
    mockHealthy.mockResolvedValue({ data: { healthy: true } })
    mockSessionCreate.mockResolvedValue({ data: { id: "session-123" } })
    mockSessionPrompt.mockResolvedValue({ data: {} })
    mockSessionAbort.mockResolvedValue({ data: {} })
    mockGlobalEvent.mockResolvedValue({
      stream: (async function* () {
        // Empty async generator
      })(),
    })
  })

  async function freshService() {
    vi.resetModules()
    const mod = await import("../opencode")
    return mod.opencodeAgentService
  }

  it("starts with no running conversations", async () => {
    const service = await freshService()

    expect(service.isRunning("any-id")).toBe(false)
    expect(service.getSessionId("any-id")).toBeNull()
  })

  it("sendMessage starts OpenCode server for new conversation", async () => {
    const service = await freshService()
    // Mock server response with port
    vi.mocked(invoke).mockResolvedValue('{"port":14096}')

    await service.sendMessage("conv-1", "hello", "/tmp/workdir")

    expect(invoke).toHaveBeenCalledWith("start_opencode_server", {
      serverId: "conv-1",
      opencodePath: "opencode",
      port: 14096,
      logDir: null,
      logId: "conv-1",
    })
    expect(service.isRunning("conv-1")).toBe(true)
  })

  it("stopChat stops the server", async () => {
    const service = await freshService()
    vi.mocked(invoke).mockResolvedValue('{"port":14096}')

    await service.sendMessage("conv-1", "hello", "/tmp/workdir")
    await service.stopChat("conv-1")

    expect(invoke).toHaveBeenCalledWith("stop_opencode_server", {
      serverId: "conv-1",
    })
  })

  it("removeChat cleans up state", async () => {
    const service = await freshService()

    service.setSessionId("conv-1", "session-123")
    expect(service.getSessionId("conv-1")).toBe("session-123")

    service.removeChat("conv-1")
    expect(service.getSessionId("conv-1")).toBeNull()
  })
})
