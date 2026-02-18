import { observable, action, makeObservable } from "mobx"

/**
 * Store for UI state that doesn't need to be persisted.
 * Used for mobile sidebar visibility and other transient UI state.
 */
class UIStore {
  @observable leftSidebarOpen = false
  @observable rightSidebarOpen = false

  constructor() {
    makeObservable(this)
  }

  @action
  toggleLeftSidebar() {
    this.leftSidebarOpen = !this.leftSidebarOpen
    // Close right sidebar when opening left
    if (this.leftSidebarOpen) {
      this.rightSidebarOpen = false
    }
  }

  @action
  toggleRightSidebar() {
    this.rightSidebarOpen = !this.rightSidebarOpen
    // Close left sidebar when opening right
    if (this.rightSidebarOpen) {
      this.leftSidebarOpen = false
    }
  }

  @action
  closeAllSidebars() {
    this.leftSidebarOpen = false
    this.rightSidebarOpen = false
  }

  @action
  setLeftSidebarOpen(open: boolean) {
    this.leftSidebarOpen = open
    if (open) {
      this.rightSidebarOpen = false
    }
  }

  @action
  setRightSidebarOpen(open: boolean) {
    this.rightSidebarOpen = open
    if (open) {
      this.leftSidebarOpen = false
    }
  }
}

export const uiStore = new UIStore()
