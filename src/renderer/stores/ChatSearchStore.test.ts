/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { chatSearchStore } from "./ChatSearchStore"

// jsdom doesn't implement scrollIntoView; the highlighter calls it when navigating matches.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  chatSearchStore.reset()
  chatSearchStore.setContainer(null)
})

function containerWith(text: string): HTMLElement {
  const el = document.createElement("div")
  el.innerHTML = `<p>${text}</p>`
  document.body.appendChild(el)
  return el
}

describe("ChatSearchStore", () => {
  it("open() activates and clears prior state", () => {
    chatSearchStore.open()
    expect(chatSearchStore.active).toBe(true)
    expect(chatSearchStore.query).toBe("")
    expect(chatSearchStore.matchCount).toBe(0)
    expect(chatSearchStore.currentIndex).toBe(-1)
  })

  it("setQuery() counts matches and selects the first", () => {
    chatSearchStore.setContainer(containerWith("alpha beta alpha gamma alpha"))
    chatSearchStore.open()
    chatSearchStore.setQuery("alpha")
    expect(chatSearchStore.matchCount).toBe(3)
    expect(chatSearchStore.currentIndex).toBe(0)
  })

  it("next() and prev() wrap around both ends", () => {
    chatSearchStore.setContainer(containerWith("x here x here x"))
    chatSearchStore.open()
    chatSearchStore.setQuery("x")
    expect(chatSearchStore.currentIndex).toBe(0)

    chatSearchStore.next()
    expect(chatSearchStore.currentIndex).toBe(1)
    chatSearchStore.next()
    expect(chatSearchStore.currentIndex).toBe(2)
    chatSearchStore.next() // wraps to first
    expect(chatSearchStore.currentIndex).toBe(0)
    chatSearchStore.prev() // wraps to last
    expect(chatSearchStore.currentIndex).toBe(2)
  })

  it("reports no matches for an absent query", () => {
    chatSearchStore.setContainer(containerWith("nothing to see"))
    chatSearchStore.open()
    chatSearchStore.setQuery("absent")
    expect(chatSearchStore.matchCount).toBe(0)
    expect(chatSearchStore.currentIndex).toBe(-1)
  })

  it("reset() closes search and clears counts", () => {
    chatSearchStore.setContainer(containerWith("value value"))
    chatSearchStore.open()
    chatSearchStore.setQuery("value")
    expect(chatSearchStore.matchCount).toBe(2)

    chatSearchStore.reset()
    expect(chatSearchStore.active).toBe(false)
    expect(chatSearchStore.query).toBe("")
    expect(chatSearchStore.matchCount).toBe(0)
    expect(chatSearchStore.currentIndex).toBe(-1)
  })
})
