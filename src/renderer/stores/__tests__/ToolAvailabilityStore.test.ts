import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

describe("ToolAvailabilityStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("ensureClaude returns cached result if already checked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "1.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First call should invoke the command
    const result1 = await toolAvailabilityStore.ensureClaude()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(result1.available).toBe(true)
    expect(result1.version).toBe("1.0.0")

    // Second call should return cached result
    const result2 = await toolAvailabilityStore.ensureClaude()
    expect(invoke).toHaveBeenCalledTimes(1) // Still 1, not 2
    expect(result2).toEqual(result1)
  })

  it("ensureClaude calls Tauri command if not checked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "2.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    expect(toolAvailabilityStore.claude).toBeNull()

    const result = await toolAvailabilityStore.ensureClaude()

    expect(invoke).toHaveBeenCalledWith("check_command_exists", {
      command: expect.any(String),
    })
    expect(result.available).toBe(true)
    expect(toolAvailabilityStore.claude).not.toBeNull()
  })

  it("recheckClaude always calls Tauri command", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ available: true, version: "1.0.0" })
      .mockResolvedValueOnce({ available: true, version: "2.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First check
    await toolAvailabilityStore.recheckClaude()
    expect(invoke).toHaveBeenCalledTimes(1)

    // Second check - should still call invoke
    const result = await toolAvailabilityStore.recheckClaude()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(result.version).toBe("2.0.0")
  })

  it("invalidate clears cached status", async () => {
    vi.mocked(invoke).mockResolvedValue({ available: true, version: "1.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First, ensure claude is checked
    await toolAvailabilityStore.ensureClaude()
    expect(toolAvailabilityStore.claude).not.toBeNull()

    // Invalidate
    toolAvailabilityStore.invalidate("claude")
    expect(toolAvailabilityStore.claude).toBeNull()
  })

  it("invalidateAll clears all cached statuses", async () => {
    vi.mocked(invoke).mockResolvedValue({ available: true, version: "1.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // Check multiple tools
    await toolAvailabilityStore.ensureClaude()
    await toolAvailabilityStore.ensureCodex()
    await toolAvailabilityStore.ensureGh()

    expect(toolAvailabilityStore.claude).not.toBeNull()
    expect(toolAvailabilityStore.codex).not.toBeNull()
    expect(toolAvailabilityStore.gh).not.toBeNull()

    // Invalidate all
    toolAvailabilityStore.invalidateAll()

    expect(toolAvailabilityStore.claude).toBeNull()
    expect(toolAvailabilityStore.codex).toBeNull()
    expect(toolAvailabilityStore.gh).toBeNull()
  })

  it("handles command check failure gracefully", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Tauri invoke failed"))

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    const result = await toolAvailabilityStore.ensureClaude()

    expect(result.available).toBe(false)
    expect(result.error).toBe("Tauri invoke failed")
    expect(result.lastChecked).toBeGreaterThan(0)
  })

  it("handles command available with version", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "claude 1.2.3",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    const result = await toolAvailabilityStore.ensureClaude()

    expect(result.available).toBe(true)
    expect(result.version).toBe("claude 1.2.3")
    expect(result.error).toBeUndefined()
    expect(result.lastChecked).toBeGreaterThan(0)
  })

  it("handles command not found", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: false,
      error: "command not found: claude",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    const result = await toolAvailabilityStore.ensureClaude()

    expect(result.available).toBe(false)
    expect(result.error).toBe("command not found: claude")
    expect(result.version).toBeUndefined()
  })

  it("markUnavailable sets error status", async () => {
    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    toolAvailabilityStore.markUnavailable("claude", "spawn failed: ENOENT")

    expect(toolAvailabilityStore.claude).not.toBeNull()
    expect(toolAvailabilityStore.claude?.available).toBe(false)
    expect(toolAvailabilityStore.claude?.error).toBe("spawn failed: ENOENT")
  })

  it("ensureGh checks gh command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "gh version 2.40.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    const result = await toolAvailabilityStore.ensureGh()

    expect(invoke).toHaveBeenCalledWith("check_command_exists", {
      command: "gh",
    })
    expect(result.available).toBe(true)
  })

  it("ensureEditor extracts binary from command with args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "1.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // The configStore default is "code"
    await toolAvailabilityStore.ensureEditor()

    expect(invoke).toHaveBeenCalledWith("check_command_exists", {
      command: "code",
    })
  })

  it("ensureTerminal extracts binary from command with args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "1.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // The configStore default is "open -a iTerm", should extract "open"
    await toolAvailabilityStore.ensureTerminal()

    expect(invoke).toHaveBeenCalledWith("check_command_exists", {
      command: "open",
    })
  })

  it("ensureGemini returns cached result if already checked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "1.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First call should invoke the command
    const result1 = await toolAvailabilityStore.ensureGemini()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(result1.available).toBe(true)
    expect(result1.version).toBe("1.0.0")

    // Second call should return cached result
    const result2 = await toolAvailabilityStore.ensureGemini()
    expect(invoke).toHaveBeenCalledTimes(1) // Still 1, not 2
    expect(result2).toEqual(result1)
  })

  it("ensureGemini calls Tauri command if not checked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      available: true,
      version: "2.0.0",
    })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    expect(toolAvailabilityStore.gemini).toBeNull()

    const result = await toolAvailabilityStore.ensureGemini()

    expect(invoke).toHaveBeenCalledWith("check_command_exists", {
      command: expect.any(String),
    })
    expect(result.available).toBe(true)
    expect(toolAvailabilityStore.gemini).not.toBeNull()
  })

  it("recheckGemini always calls Tauri command", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ available: true, version: "1.0.0" })
      .mockResolvedValueOnce({ available: true, version: "2.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First check
    await toolAvailabilityStore.recheckGemini()
    expect(invoke).toHaveBeenCalledTimes(1)

    // Second check - should still call invoke
    const result = await toolAvailabilityStore.recheckGemini()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(result.version).toBe("2.0.0")
  })

  it("invalidate clears gemini cached status", async () => {
    vi.mocked(invoke).mockResolvedValue({ available: true, version: "1.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // First, ensure gemini is checked
    await toolAvailabilityStore.ensureGemini()
    expect(toolAvailabilityStore.gemini).not.toBeNull()

    // Invalidate
    toolAvailabilityStore.invalidate("gemini")
    expect(toolAvailabilityStore.gemini).toBeNull()
  })

  it("invalidateAll clears gemini along with other cached statuses", async () => {
    vi.mocked(invoke).mockResolvedValue({ available: true, version: "1.0.0" })

    const { toolAvailabilityStore } = await import("../ToolAvailabilityStore")

    // Check gemini
    await toolAvailabilityStore.ensureGemini()
    expect(toolAvailabilityStore.gemini).not.toBeNull()

    // Invalidate all
    toolAvailabilityStore.invalidateAll()

    expect(toolAvailabilityStore.gemini).toBeNull()
  })
})
