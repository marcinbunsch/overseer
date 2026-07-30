/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useKeyboardShortcuts } from "./useKeyboardShortcuts"
import { chatSearchStore } from "../stores/ChatSearchStore"

let isMac = true
vi.mock("../utils/platform", () => ({ isMacOS: () => isMac }))

function pressF(modifiers: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "f", cancelable: true, ...modifiers })
  document.dispatchEvent(event)
  return event
}

describe("useKeyboardShortcuts — in-session search trigger", () => {
  beforeEach(() => {
    vi.spyOn(chatSearchStore, "open").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("opens search on Cmd+F on macOS and prevents the native find", () => {
    isMac = true
    renderHook(() => useKeyboardShortcuts())
    const event = pressF({ metaKey: true })
    expect(chatSearchStore.open).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it("opens search on Ctrl+F off macOS", () => {
    isMac = false
    renderHook(() => useKeyboardShortcuts())
    const event = pressF({ ctrlKey: true })
    expect(chatSearchStore.open).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it("does not open on Ctrl+F on macOS (wrong modifier)", () => {
    isMac = true
    renderHook(() => useKeyboardShortcuts())
    pressF({ ctrlKey: true })
    expect(chatSearchStore.open).not.toHaveBeenCalled()
  })

  it("does not open on Cmd+Shift+F", () => {
    isMac = true
    renderHook(() => useKeyboardShortcuts())
    pressF({ metaKey: true, shiftKey: true })
    expect(chatSearchStore.open).not.toHaveBeenCalled()
  })
})
