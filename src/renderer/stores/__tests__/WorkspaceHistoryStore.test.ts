import { describe, it, expect, vi, beforeEach } from "vitest"
import { invoke } from "@tauri-apps/api/core"

describe("WorkspaceHistoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_json_config") {
        return Promise.resolve({ history: [], historyIndex: -1 })
      }
      if (cmd === "save_json_config") return Promise.resolve(undefined)
      return Promise.resolve(undefined)
    })
  })

  describe("push", () => {
    it("adds workspace to history", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1"])
      expect(state.historyIndex).toBe(0)
    })

    it("does not add duplicate at current position", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-1")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1"])
      expect(state.historyIndex).toBe(0)
    })

    it("adds different workspace after current", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1", "ws-2", "ws-3"])
      expect(state.historyIndex).toBe(2)
    })

    it("truncates forward history when pushing from middle", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      // Go back twice
      workspaceHistoryStore.goBack()
      workspaceHistoryStore.goBack()

      // Now at ws-1, push a new workspace
      workspaceHistoryStore.push("ws-4")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1", "ws-4"])
      expect(state.historyIndex).toBe(1)
    })

    it("moves existing workspace to end instead of duplicating", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      // Push ws-1 again - should move it to end, not duplicate
      workspaceHistoryStore.push("ws-1")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-2", "ws-3", "ws-1"])
      expect(state.historyIndex).toBe(2)
    })
  })

  describe("goBack", () => {
    it("returns null when at start of history", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      const result = workspaceHistoryStore.goBack()
      expect(result).toBeNull()
    })

    it("returns previous workspace when history exists", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      const result = workspaceHistoryStore.goBack()
      expect(result).toBe("ws-2")

      const state = workspaceHistoryStore.getState()
      expect(state.historyIndex).toBe(1)
    })

    it("can go back multiple times", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      expect(workspaceHistoryStore.goBack()).toBe("ws-2")
      expect(workspaceHistoryStore.goBack()).toBe("ws-1")
      expect(workspaceHistoryStore.goBack()).toBeNull()
    })
  })

  describe("goForward", () => {
    it("returns null when at end of history", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      const result = workspaceHistoryStore.goForward()
      expect(result).toBeNull()
    })

    it("returns next workspace after going back", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      workspaceHistoryStore.goBack()
      workspaceHistoryStore.goBack()

      const result = workspaceHistoryStore.goForward()
      expect(result).toBe("ws-2")

      const state = workspaceHistoryStore.getState()
      expect(state.historyIndex).toBe(1)
    })

    it("can go forward multiple times", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      workspaceHistoryStore.goBack()
      workspaceHistoryStore.goBack()

      expect(workspaceHistoryStore.goForward()).toBe("ws-2")
      expect(workspaceHistoryStore.goForward()).toBe("ws-3")
      expect(workspaceHistoryStore.goForward()).toBeNull()
    })
  })

  describe("canGoBack and canGoForward", () => {
    it("canGoBack is false when at start", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      expect(workspaceHistoryStore.canGoBack).toBe(false)
    })

    it("canGoBack is true when not at start", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")

      expect(workspaceHistoryStore.canGoBack).toBe(true)
    })

    it("canGoForward is false when at end", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      expect(workspaceHistoryStore.canGoForward).toBe(false)
    })

    it("canGoForward is true after going back", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.goBack()

      expect(workspaceHistoryStore.canGoForward).toBe(true)
    })
  })

  describe("remove", () => {
    it("removes workspace from history", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      workspaceHistoryStore.remove("ws-2")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1", "ws-3"])
    })

    it("adjusts index when removing before current position", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")
      workspaceHistoryStore.push("ws-2")
      workspaceHistoryStore.push("ws-3")

      // At ws-3 (index 2)
      workspaceHistoryStore.remove("ws-1")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-2", "ws-3"])
      expect(state.historyIndex).toBe(1) // Adjusted from 2 to 1
    })

    it("does nothing for non-existent workspace", async () => {
      vi.resetModules()
      const { workspaceHistoryStore } = await import("../WorkspaceHistoryStore")

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("load_json_config", { filename: "history.json" })
      })

      workspaceHistoryStore.reset()
      workspaceHistoryStore.push("ws-1")

      workspaceHistoryStore.remove("ws-nonexistent")

      const state = workspaceHistoryStore.getState()
      expect(state.history).toEqual(["ws-1"])
    })
  })
})
