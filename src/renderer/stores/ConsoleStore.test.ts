/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ConsoleEntry } from "./ConsoleStore"

// Each test gets a fresh module instance so the singleton's `initialized` flag
// and console patching don't leak between tests.
async function freshStore() {
  vi.resetModules()
  const mod = await import("./ConsoleStore")
  return mod.consoleStore
}

describe("ConsoleStore global error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("captures uncaught window errors as error entries", async () => {
    const store = await freshStore()
    vi.spyOn(console, "error").mockImplementation(() => {})
    store.init()

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "app.js",
        lineno: 10,
        colno: 5,
        error: new Error("boom"),
      })
    )

    const errors = store.entries.filter((e) => e.level === "error")
    expect(errors.length).toBe(1)
    expect(errors[0].message).toContain("Uncaught: boom")
    expect(errors[0].message).toContain("app.js:10:5")
  })

  it("forwards error entries to the remote sink", async () => {
    const store = await freshStore()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sink = vi.fn<(entry: ConsoleEntry) => void>()
    store.setRemoteSink(sink)
    store.init()

    console.error("something broke")

    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0].level).toBe("error")
    expect(sink.mock.calls[0][0].message).toContain("something broke")
  })

  it("does not forward non-error levels to the remote sink", async () => {
    const store = await freshStore()
    const sink = vi.fn<(entry: ConsoleEntry) => void>()
    store.setRemoteSink(sink)
    store.init()

    console.log("just info")

    expect(sink).not.toHaveBeenCalled()
  })

  it("swallows a throwing remote sink", async () => {
    const store = await freshStore()
    vi.spyOn(console, "error").mockImplementation(() => {})
    store.setRemoteSink(() => {
      throw new Error("sink is broken")
    })
    store.init()

    expect(() => console.error("boom")).not.toThrow()
    // The entry is still recorded locally even though the sink failed.
    expect(store.entries.some((e) => e.message.includes("boom"))).toBe(true)
  })
})
