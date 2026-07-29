import { observable, action, makeObservable } from "mobx"
import { SearchHighlighter, type SearchState } from "../components/chat/searchHighlighter"

/**
 * State machine for in-session Cmd/Ctrl-F search, scoped to the active chat.
 *
 * When `active`, MessageList reveals every turn and the collapsible sections force open, so
 * the whole session is in the DOM. The owned SearchHighlighter then walks that DOM, counts
 * matches, and paints/scrolls the current one. Reset when the active chat changes.
 */
class ChatSearchStore {
  @observable active = false
  @observable query = ""
  @observable matchCount = 0
  /** 0-based index of the active match, or -1 when there are none. */
  @observable currentIndex = -1
  /** True when the session was too large to fully reveal, so search covers visible text only. */
  @observable revealCapped = false

  private highlighter = new SearchHighlighter()

  constructor() {
    makeObservable(this)
  }

  /** The scroll container is registered by MessageList; both feed the highlighter's DOM walk. */
  setContainer(container: HTMLElement | null): void {
    this.highlighter.setContainer(container)
  }

  @action open(): void {
    this.active = true
    this.query = ""
    // Clear any highlights left from a previous open (Cmd+F pressed while already open).
    this.highlighter.clear()
    this.matchCount = 0
    this.currentIndex = -1
  }

  @action close(): void {
    this.active = false
    this.query = ""
    this.revealCapped = false
    this.highlighter.clear()
    this.matchCount = 0
    this.currentIndex = -1
  }

  @action setQuery(query: string): void {
    this.query = query
    this.applyState(this.highlighter.search(query))
  }

  @action next(): void {
    this.applyState(this.highlighter.next())
  }

  @action prev(): void {
    this.applyState(this.highlighter.prev())
  }

  /** Re-run the current query against the DOM — after a reveal render or streamed content. */
  @action recompute(): void {
    if (!this.active) return
    this.applyState(this.highlighter.search(this.query))
  }

  @action setRevealCapped(capped: boolean): void {
    this.revealCapped = capped
  }

  /** Clear everything when the active chat switches out from under an open search. */
  @action reset(): void {
    this.close()
  }

  @action private applyState(state: SearchState): void {
    this.matchCount = state.matchCount
    this.currentIndex = state.currentIndex
  }
}

export const chatSearchStore = new ChatSearchStore()
