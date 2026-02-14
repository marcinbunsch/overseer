import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

describe("DebugStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads debug mode as true when OVERSEER_DEBUG is set", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "is_debug_mode") return Promise.resolve(true)
      if (cmd === "is_demo_mode") return Promise.resolve(false)
      return Promise.reject(new Error("Unknown command"))
    })

    vi.resetModules()
    const { debugStore } = await import("../DebugStore")

    await vi.waitFor(() => {
      expect(debugStore.loaded).toBe(true)
    })

    expect(debugStore.isDebugMode).toBe(true)
    expect(invoke).toHaveBeenCalledWith("is_debug_mode")
    expect(invoke).toHaveBeenCalledWith("is_demo_mode")
  })

  it("enables debug mode in dev mode even when OVERSEER_DEBUG is not set", async () => {
    // In test environment, import.meta.env.DEV is true, so debug mode is enabled
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "is_debug_mode") return Promise.resolve(false)
      if (cmd === "is_demo_mode") return Promise.resolve(false)
      return Promise.reject(new Error("Unknown command"))
    })

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
    // Demo mode should default to false on error
    expect(debugStore.isDemoMode).toBe(false)
  })

  describe("demo mode", () => {
    it("loads demo mode as true when OVERSEER_DEMO is set", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "is_debug_mode") return Promise.resolve(false)
        if (cmd === "is_demo_mode") return Promise.resolve(true)
        return Promise.reject(new Error("Unknown command"))
      })

      vi.resetModules()
      const { debugStore } = await import("../DebugStore")

      await vi.waitFor(() => {
        expect(debugStore.loaded).toBe(true)
      })

      expect(debugStore.isDemoMode).toBe(true)
    })

    it("loads demo mode as false when OVERSEER_DEMO is not set", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "is_debug_mode") return Promise.resolve(false)
        if (cmd === "is_demo_mode") return Promise.resolve(false)
        return Promise.reject(new Error("Unknown command"))
      })

      vi.resetModules()
      const { debugStore } = await import("../DebugStore")

      await vi.waitFor(() => {
        expect(debugStore.loaded).toBe(true)
      })

      expect(debugStore.isDemoMode).toBe(false)
    })

    it("defaults demo mode to false on invoke error", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("invoke failed"))

      vi.resetModules()
      const { debugStore } = await import("../DebugStore")

      await vi.waitFor(() => {
        expect(debugStore.loaded).toBe(true)
      })

      expect(debugStore.isDemoMode).toBe(false)
    })
  })

  describe("showDevUI computed property", () => {
    it("returns true in dev mode when demo mode is disabled", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "is_debug_mode") return Promise.resolve(false)
        if (cmd === "is_demo_mode") return Promise.resolve(false)
        return Promise.reject(new Error("Unknown command"))
      })

      vi.resetModules()
      const { debugStore } = await import("../DebugStore")

      await vi.waitFor(() => {
        expect(debugStore.loaded).toBe(true)
      })

      // In test environment, import.meta.env.DEV is true
      expect(debugStore.isDevMode).toBe(true)
      expect(debugStore.isDemoMode).toBe(false)
      expect(debugStore.showDevUI).toBe(true)
    })

    it("returns false in dev mode when demo mode is enabled", async () => {
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "is_debug_mode") return Promise.resolve(false)
        if (cmd === "is_demo_mode") return Promise.resolve(true)
        return Promise.reject(new Error("Unknown command"))
      })

      vi.resetModules()
      const { debugStore } = await import("../DebugStore")

      await vi.waitFor(() => {
        expect(debugStore.loaded).toBe(true)
      })

      // In test environment, import.meta.env.DEV is true
      expect(debugStore.isDevMode).toBe(true)
      expect(debugStore.isDemoMode).toBe(true)
      // showDevUI should be false because demo mode hides dev UI
      expect(debugStore.showDevUI).toBe(false)
    })
  })
})
