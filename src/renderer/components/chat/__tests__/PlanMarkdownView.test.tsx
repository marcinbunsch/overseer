/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { PlanMarkdownView } from "../PlanMarkdownView"
import { PlanReviewStore } from "../../../stores/PlanReviewStore"

interface FakeSource {
  id: string
  text: string
  startMeta: { parentTagName: string; parentIndex: number; textOffset: number }
  endMeta: { parentTagName: string; parentIndex: number; textOffset: number }
}

interface MockHighlighterInstance {
  handlers: Record<string, (data: { sources: FakeSource[]; type: string }) => void>
  domsById: Record<string, HTMLElement[]>
  classesById: Record<string, Set<string>>
  removed: string[]
  emitCreate: (source: FakeSource, doms: HTMLElement[]) => void
}

const wh = vi.hoisted(() => ({ instances: [] as MockHighlighterInstance[] }))

// Mock web-highlighter: the DOM engine is exercised in the real app, not jsdom. Here we
// only verify our wiring (selection -> popover -> note, cancel -> remove, reconcile).
vi.mock("@plannotator/web-highlighter", () => {
  class MockHighlighter {
    static event = { CREATE: "selection:create", CLICK: "selection:click" }
    handlers: Record<string, (data: { sources: FakeSource[]; type: string }) => void> = {}
    domsById: Record<string, HTMLElement[]> = {}
    classesById: Record<string, Set<string>> = {}
    removed: string[] = []
    constructor() {
      wh.instances.push(this)
    }
    on(event: string, fn: (data: { sources: FakeSource[]; type: string }) => void) {
      this.handlers[event] = fn
    }
    run() {}
    dispose() {}
    getDoms(id: string): HTMLElement[] {
      return this.domsById[id] ?? []
    }
    remove(id: string) {
      this.removed.push(id)
      delete this.domsById[id]
    }
    addClass(className: string, id: string) {
      ;(this.classesById[id] ??= new Set()).add(className)
    }
    fromStore(_s: unknown, _e: unknown, _text: string, id: string) {
      this.domsById[id] = [document.createElement("mark")]
      return { id }
    }
    emitCreate(source: FakeSource, doms: HTMLElement[]) {
      this.domsById[source.id] = doms
      this.handlers["selection:create"]?.({ sources: [source], type: "from-input" })
    }
  }
  return { default: MockHighlighter }
})

// markdownComponents imports the Tauri shell plugin (for opening links); stub it.
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }))

// Real react-markdown so rehypeSourceLines stamps data-src-* attributes; only the heavy
// syntax highlighter is mocked (unused here — the plan has no code fences).
vi.mock("react-syntax-highlighter", () => ({
  PrismAsyncLight: ({ children }: { children: string }) => <code>{children}</code>,
}))
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }))

const anchor = {
  startMeta: { parentTagName: "H1", parentIndex: 0, textOffset: 0 },
  endMeta: { parentTagName: "H1", parentIndex: 0, textOffset: 4 },
}

describe("PlanMarkdownView", () => {
  let store: PlanReviewStore
  const planContent = "# Plan\n\nStep one.\n\nStep two."

  beforeEach(() => {
    vi.clearAllMocks()
    wh.instances.length = 0
    store = new PlanReviewStore()
  })

  /** Simulate web-highlighter capturing a selection inside the given block. */
  function selectInside(blockEl: Element, id: string, text: string): FakeSource {
    const mark = document.createElement("mark")
    mark.textContent = text
    blockEl.appendChild(mark)
    const source: FakeSource = { id, text, startMeta: anchor.startMeta, endMeta: anchor.endMeta }
    act(() => wh.instances[0].emitCreate(source, [mark]))
    return source
  }

  it("renders markdown and stamps source line attributes", () => {
    const { container } = render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    const heading = container.querySelector("h1")
    expect(heading?.textContent).toBe("Plan")
    expect(heading?.getAttribute("data-src-start")).toBe("1")
  })

  it("shows the select-to-comment instruction", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)
    expect(screen.getByText("Select text to comment on it.")).toBeInTheDocument()
  })

  it("shows the Comment popover after a selection is captured", () => {
    const { container } = render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    selectInside(container.querySelector("h1")!, "wh-1", "Plan")

    expect(screen.getByTestId("plan-selection-comment-btn")).toBeInTheDocument()
  })

  it("adds a note with the selected text, comment and line range derived from the mark", () => {
    const { container } = render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    selectInside(container.querySelector("h1")!, "wh-1", "Plan")
    fireEvent.click(screen.getByTestId("plan-selection-comment-btn"))
    fireEvent.change(screen.getByTestId("plan-selection-comment-input"), {
      target: { value: "make this clearer" },
    })
    fireEvent.click(screen.getByText("Add Comment"))

    expect(store.notes).toHaveLength(1)
    expect(store.notes[0]).toMatchObject({
      id: "wh-1",
      selectedText: "Plan",
      comment: "make this clearer",
      startLine: 1, // derived from the h1 block (data-src-start=1)
      endLine: 1,
    })
    // The mark is tagged as committed.
    expect(wh.instances[0].classesById["wh-1"]).toContain("committed")
  })

  it("removes the mark and keeps no note when the editor is dismissed by clicking outside", () => {
    const { container } = render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    selectInside(container.querySelector("h1")!, "wh-1", "Plan")
    fireEvent.click(screen.getByTestId("plan-selection-comment-btn"))
    expect(screen.getByTestId("plan-selection-comment-editor")).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByTestId("plan-selection-comment-editor")).not.toBeInTheDocument()
    expect(store.notes).toHaveLength(0)
    expect(wh.instances[0].removed).toContain("wh-1")
  })

  it("removes a committed mark when its note is deleted from the store", () => {
    store.addPreviewNote({
      id: "wh-9",
      startLine: 1,
      endLine: 1,
      selectedText: "Plan",
      comment: "earlier note",
      anchor,
    })
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)

    // Reconcile painted it on mount.
    expect(wh.instances[0].domsById["wh-9"]?.length).toBeGreaterThan(0)

    act(() => store.removeNote("wh-9"))

    expect(wh.instances[0].removed).toContain("wh-9")
  })

  it("shows the comment count badge for committed notes", () => {
    store.addPreviewNote({
      id: "wh-1",
      startLine: 1,
      endLine: 1,
      selectedText: "Plan",
      comment: "one",
      anchor,
    })
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)
    expect(screen.getByText("1 comment")).toBeInTheDocument()
  })

  it("does not show the comment count badge when there are no notes", () => {
    render(<PlanMarkdownView planContent={planContent} notesStore={store} />)
    expect(screen.queryByText(/^\d+ comments?$/)).not.toBeInTheDocument()
  })
})
