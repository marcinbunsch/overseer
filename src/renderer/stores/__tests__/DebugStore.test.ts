import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

describe("DebugStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads debug mode as true when OVERSEER_DEBUG is set", async () => {
    vi.mocked(invoke).mockResolvedValue(true)

    vi.resetModules()
    const { debugStore } = await import("../DebugStore")

    await vi.waitFor(() => {
      expect(debugStore.loaded).toBe(true)
    })

    expect(debugStore.isDebugMode).toBe(true)
    expect(invoke).toHaveBeenCalledWith("is_debug_mode")
  })

  it("enables debug mode in dev mode even when OVERSEER_DEBUG is not set", async () => {
    // In test environment, import.meta.env.DEV is true, so debug mode is enabled
    vi.mocked(invoke).mockResolvedValue(false)

    vi.resetModules()
    const { debugStore } = await import("../DebugStore")

    await vi.waitFor(() => {
      expect(debugStore.loaded).toBe(true)
    })

    // Debug mode should be true because we're in dev/test mode
    expect(debugStore.isDebugMode).toBe(true)
  })

  it("enables debug mode in dev mode even on invoke error", async () => {
    // In test environment, import.meta.env.DEV is true, so debug mode is enabled
    vi.mocked(invoke).mockRejectedValue(new Error("invoke failed"))

    vi.resetModules()
    const { debugStore } = await import("../DebugStore")

    await vi.waitFor(() => {
      expect(debugStore.loaded).toBe(true)
    })

    // Debug mode should be true because we're in dev/test mode
    expect(debugStore.isDebugMode).toBe(true)
  })
})
