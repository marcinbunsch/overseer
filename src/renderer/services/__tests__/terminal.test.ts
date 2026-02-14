/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Tauri core
const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Mock Tauri events
type EventCallback = (event: { payload: unknown }) => void
const eventListeners = new Map<string, EventCallback>()
const mockListen = vi.fn((event: string, callback: EventCallback): Promise<() => void> => {
  eventListeners.set(event, callback)
  return Promise.resolve(() => {
    eventListeners.delete(event)
  })
})

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(args[0] as string, args[1] as EventCallback),
}))

// Mock xterm - defined inline to avoid hoisting issues
vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon = vi.fn()
    open = vi.fn()
    write = vi.fn()
    clear = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    attachCustomKeyEventHandler = vi.fn()
    dispose = vi.fn()
    refresh = vi.fn()
  },
}))

// Mock xterm addons - defined inline to avoid hoisting issues
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}))

// Mock platform
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}))

// Mock crypto.randomUUID
let uuidCounter = 0
vi.stubGlobal("crypto", {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
})

import { stripPromptEolMark } from "../terminal"

describe("stripPromptEolMark", () => {
  it("strips PROMPT_EOL_MARK with spaces and newline", () => {
    // Typical zsh output: % followed by spaces, ESC[K (clear to EOL), then newline
    const input = "%                                                      \x1b[K\n[prompt here]"
    const result = stripPromptEolMark(input)
    expect(result).toBe("[prompt here]")
  })

  it("strips PROMPT_EOL_MARK with CRLF", () => {
    const input = "%  \x1b[K\r\n[prompt here]"
    const result = stripPromptEolMark(input)
    expect(result).toBe("[prompt here]")
  })

  it("strips PROMPT_EOL_MARK with no spaces", () => {
    const input = "%\x1b[K\n[prompt here]"
    const result = stripPromptEolMark(input)
    expect(result).toBe("[prompt here]")
  })

  it("preserves text without PROMPT_EOL_MARK", () => {
    const input = "[17:45:21] ~/project\n-> "
    const result = stripPromptEolMark(input)
    expect(result).toBe(input)
  })

  it("preserves % that is not at the start", () => {
    const input = "some text % more text"
    const result = stripPromptEolMark(input)
    expect(result).toBe(input)
  })

  it("preserves % without the ESC[K sequence", () => {
    const input = "%  \nsome text"
    const result = stripPromptEolMark(input)
    expect(result).toBe(input)
  })

  it("handles empty string", () => {
    const result = stripPromptEolMark("")
    expect(result).toBe("")
  })

  it("strips only the PROMPT_EOL_MARK, preserving rest of output", () => {
    const prompt = "[17:45:21] ~/overseer/workspaces/overseer/dingo\n-> "
    const input = `%                                                      \x1b[K\n${prompt}`
    const result = stripPromptEolMark(input)
    expect(result).toBe(prompt)
  })
})

describe("TerminalService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    uuidCounter = 0
    mockInvoke.mockResolvedValue(undefined)
  })

  it("creates a terminal instance with PTY", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", {
      id: "test-uuid-1",
      cwd: "/test/workspace",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
    })
    expect(instance.ptyId).toBe("test-uuid-1")
    expect(instance.xterm).toBeDefined()
    expect(instance.xterm.cols).toBe(80)
    expect(instance.xterm.rows).toBe(24)
  })

  it("returns cached instance for same workspace path", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance1 = await terminalService.getOrCreate("/test/workspace")
    const instance2 = await terminalService.getOrCreate("/test/workspace")

    expect(instance1).toBe(instance2)
    // Should only spawn once
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it("creates separate instances for different workspace paths", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance1 = await terminalService.getOrCreate("/test/workspace1")
    const instance2 = await terminalService.getOrCreate("/test/workspace2")

    expect(instance1).not.toBe(instance2)
    expect(instance1.ptyId).toBe("test-uuid-1")
    expect(instance2.ptyId).toBe("test-uuid-2")
  })

  it("registers event listeners for PTY data and exit", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    expect(mockListen).toHaveBeenCalledWith("pty:data:test-uuid-1", expect.any(Function))
    expect(mockListen).toHaveBeenCalledWith("pty:exit:test-uuid-1", expect.any(Function))
  })

  it("destroy cleans up all resources", async () => {
    vi.resetModules()

    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")
    terminalService.destroy("/test/workspace")

    // Should call pty_kill
    expect(mockInvoke).toHaveBeenCalledWith("pty_kill", { id: "test-uuid-1" })
    expect(instance.xterm.dispose).toHaveBeenCalled()
    // Event listeners should be cleaned up
    expect(eventListeners.size).toBe(0)
  })

  it("PTY exit event triggers instance cleanup", async () => {
    vi.resetModules()

    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    // Simulate PTY exit event
    const exitCallback = eventListeners.get("pty:exit:test-uuid-1")
    expect(exitCallback).toBeDefined()
    exitCallback!({ payload: { code: 0 } })

    // Next call should create a new instance
    await terminalService.getOrCreate("/test/workspace")

    // Should spawn twice
    expect(mockInvoke).toHaveBeenCalledWith("pty_spawn", expect.any(Object))
    const spawnCalls = mockInvoke.mock.calls.filter((call) => call[0] === "pty_spawn")
    expect(spawnCalls.length).toBe(2)
  })

  it("destroyAll cleans up all terminal instances", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace1")
    await terminalService.getOrCreate("/test/workspace2")

    terminalService.destroyAll()

    // Both should have been killed
    const killCalls = mockInvoke.mock.calls.filter((call) => call[0] === "pty_kill")
    expect(killCalls.length).toBe(2)
  })

  it("resize calls pty_resize", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")
    terminalService.resize("/test/workspace", 120, 40)

    expect(mockInvoke).toHaveBeenCalledWith("pty_resize", {
      id: "test-uuid-1",
      cols: 120,
      rows: 40,
    })
  })

  it("resize does nothing for non-existent terminal", async () => {
    vi.resetModules()
    mockInvoke.mockClear()
    const { terminalService } = await import("../terminal")

    terminalService.resize("/nonexistent/workspace", 120, 40)

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("PTY data event writes to xterm", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // Simulate PTY data event
    const dataCallback = eventListeners.get("pty:data:test-uuid-1")
    expect(dataCallback).toBeDefined()

    // Send "hello" as byte array
    const helloBytes = [104, 101, 108, 108, 111] // "hello" in ASCII
    dataCallback!({ payload: helloBytes })

    expect(instance.xterm.write).toHaveBeenCalledWith("hello")
  })

  it("xterm input is forwarded to PTY", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // Get the onData callback that was registered
    const onDataCall = (instance.xterm.onData as ReturnType<typeof vi.fn>).mock.calls[0]
    const inputCallback = onDataCall[0] as (data: string) => void

    // Simulate user typing
    inputCallback("ls -la")

    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      id: "test-uuid-1",
      data: [108, 115, 32, 45, 108, 97], // "ls -la" in ASCII
    })
  })

  it("Cmd+K clears terminal and sends Ctrl+L to PTY", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    const handlerCall = (instance.xterm.attachCustomKeyEventHandler as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    const handler = handlerCall[0] as (event: KeyboardEvent) => boolean

    const preventDefault = vi.fn()
    const result = handler({
      key: "k",
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault,
    } as unknown as KeyboardEvent)

    expect(result).toBe(false)
    expect(preventDefault).toHaveBeenCalled()
    expect(instance.xterm.clear).toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      id: "test-uuid-1",
      data: [12], // Ctrl+L
    })
  })

  it("write method sends data to PTY", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    terminalService.write("/test/workspace", "echo hello\n")

    expect(mockInvoke).toHaveBeenCalledWith("pty_write", {
      id: "test-uuid-1",
      data: [101, 99, 104, 111, 32, 104, 101, 108, 108, 111, 10], // "echo hello\n" in ASCII
    })
  })

  it("write does nothing for non-existent terminal", async () => {
    vi.resetModules()
    mockInvoke.mockClear()
    const { terminalService } = await import("../terminal")

    terminalService.write("/nonexistent/workspace", "echo hello\n")

    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe("TerminalService readyPromise", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    uuidCounter = 0
    mockInvoke.mockResolvedValue(undefined)
  })

  it("readyPromise resolves when first PTY data is received", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // readyPromise should not be resolved yet
    let resolved = false
    instance.readyPromise.then(() => {
      resolved = true
    })

    // Should not be resolved before data
    await Promise.resolve()
    expect(resolved).toBe(false)

    // Simulate PTY data event
    const dataCallback = eventListeners.get("pty:data:test-uuid-1")
    expect(dataCallback).toBeDefined()
    const encoder = new TextEncoder()
    dataCallback!({ payload: Array.from(encoder.encode("[prompt] -> ")) })

    // Now it should be resolved
    await instance.readyPromise
    expect(resolved).toBe(true)
  })

  it("waitForReady resolves after first PTY data", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    // Simulate PTY data event
    const dataCallback = eventListeners.get("pty:data:test-uuid-1")
    const encoder = new TextEncoder()
    dataCallback!({ payload: Array.from(encoder.encode("[prompt] -> ")) })

    // waitForReady should resolve
    await terminalService.waitForReady("/test/workspace")
    // If we got here, the test passed
  })

  it("waitForReady returns immediately for non-existent terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    // Should not throw or hang
    await terminalService.waitForReady("/nonexistent/workspace")
  })
})

describe("TerminalService PROMPT_EOL_MARK stripping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    uuidCounter = 0
    mockInvoke.mockResolvedValue(undefined)
  })

  it("strips PROMPT_EOL_MARK from first PTY output chunk", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // Simulate PTY data event with PROMPT_EOL_MARK
    const dataCallback = eventListeners.get("pty:data:test-uuid-1")
    expect(dataCallback).toBeDefined()

    // Encode "%  \x1b[K\n[prompt] -> " as bytes
    const encoder = new TextEncoder()
    const input = "%                        \x1b[K\n[prompt] -> "
    const inputBytes = Array.from(encoder.encode(input))
    dataCallback!({ payload: inputBytes })

    expect(instance.xterm.write).toHaveBeenCalledWith("[prompt] -> ")
  })

  it("does not strip from subsequent PTY output chunks", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    const dataCallback = eventListeners.get("pty:data:test-uuid-1")
    expect(dataCallback).toBeDefined()

    const encoder = new TextEncoder()

    // First chunk (stripped)
    const firstInput = "%  \x1b[K\nfirst"
    dataCallback!({ payload: Array.from(encoder.encode(firstInput)) })
    expect(instance.xterm.write).toHaveBeenLastCalledWith("first")

    // Second chunk with % should NOT be stripped (not at start of session)
    const secondInput = "%  \x1b[K\nsecond"
    dataCallback!({ payload: Array.from(encoder.encode(secondInput)) })
    expect(instance.xterm.write).toHaveBeenLastCalledWith(secondInput)
  })
})

describe("TerminalService hasInput tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    uuidCounter = 0
    mockInvoke.mockResolvedValue(undefined)
  })

  it("has() returns false for non-existent terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    expect(terminalService.has("/nonexistent/workspace")).toBe(false)
  })

  it("has() returns true for existing terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    expect(terminalService.has("/test/workspace")).toBe(true)
  })

  it("hasInput starts as false for new terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    expect(instance.hasInput).toBe(false)
    expect(terminalService.hasInput("/test/workspace")).toBe(false)
  })

  it("hasInput returns false for non-existent terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    expect(terminalService.hasInput("/nonexistent/workspace")).toBe(false)
  })

  it("hasInput becomes true when user types in terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // Get the onData callback that was registered
    const onDataCall = (instance.xterm.onData as ReturnType<typeof vi.fn>).mock.calls[0]
    const inputCallback = onDataCall[0] as (data: string) => void

    // Simulate user typing
    inputCallback("ls")

    expect(instance.hasInput).toBe(true)
    expect(terminalService.hasInput("/test/workspace")).toBe(true)
  })

  it("hasInput becomes true when write() is called", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    expect(instance.hasInput).toBe(false)

    terminalService.write("/test/workspace", "echo hello\n")

    expect(instance.hasInput).toBe(true)
    expect(terminalService.hasInput("/test/workspace")).toBe(true)
  })

  it("destroyIfUnused destroys terminal with no input", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    expect(terminalService.has("/test/workspace")).toBe(true)

    terminalService.destroyIfUnused("/test/workspace")

    expect(terminalService.has("/test/workspace")).toBe(false)
    expect(instance.xterm.dispose).toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith("pty_kill", { id: "test-uuid-1" })
  })

  it("destroyIfUnused does NOT destroy terminal with user input", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    const instance = await terminalService.getOrCreate("/test/workspace")

    // Simulate user input
    const onDataCall = (instance.xterm.onData as ReturnType<typeof vi.fn>).mock.calls[0]
    const inputCallback = onDataCall[0] as (data: string) => void
    inputCallback("ls")

    // Clear mock to check if pty_kill is called
    mockInvoke.mockClear()

    terminalService.destroyIfUnused("/test/workspace")

    // Terminal should still exist
    expect(terminalService.has("/test/workspace")).toBe(true)
    expect(instance.xterm.dispose).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalledWith("pty_kill", expect.any(Object))
  })

  it("destroyIfUnused does NOT destroy terminal with programmatic input", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    await terminalService.getOrCreate("/test/workspace")

    // Simulate programmatic write (e.g., postCreate script)
    terminalService.write("/test/workspace", "npm install\n")

    // Clear mock to check if pty_kill is called
    mockInvoke.mockClear()

    terminalService.destroyIfUnused("/test/workspace")

    // Terminal should still exist
    expect(terminalService.has("/test/workspace")).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalledWith("pty_kill", expect.any(Object))
  })

  it("destroyIfUnused does nothing for non-existent terminal", async () => {
    vi.resetModules()
    const { terminalService } = await import("../terminal")

    // Should not throw
    terminalService.destroyIfUnused("/nonexistent/workspace")

    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
