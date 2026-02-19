import { observable, action, makeObservable } from "mobx"

/**
 * Store for UI state that doesn't need to be persisted.
 * Used for mobile sidebar visibility and other transient UI state.
 */
class UIStore {
  @observable leftSidebarOpen = false
  @observable rightSidebarOpen = false
  @observable mobileConsoleOpen = false

  constructor() {
    makeObservable(this)
  }

  @action
  toggleLeftSidebar() {
    this.leftSidebarOpen = !this.leftSidebarOpen
    // Close right sidebar and console when opening left
    if (this.leftSidebarOpen) {
      this.rightSidebarOpen = false
      this.mobileConsoleOpen = false
    }
  }

  @action
  toggleRightSidebar() {
    this.rightSidebarOpen = !this.rightSidebarOpen
    // Close left sidebar and console when opening right
    if (this.rightSidebarOpen) {
      this.leftSidebarOpen = false
      this.mobileConsoleOpen = false
    }
  }

  @action
  toggleMobileConsole() {
    this.mobileConsoleOpen = !this.mobileConsoleOpen
    // Close sidebars when opening console
    if (this.mobileConsoleOpen) {
      this.leftSidebarOpen = false
      this.rightSidebarOpen = false
    }
  }

  @action
  closeAllSidebars() {
    this.leftSidebarOpen = false
    this.rightSidebarOpen = false
    this.mobileConsoleOpen = false
  }

  @action
  setLeftSidebarOpen(open: boolean) {
    this.leftSidebarOpen = open
    if (open) {
      this.rightSidebarOpen = false
      this.mobileConsoleOpen = false
    }
  }

  @action
  setRightSidebarOpen(open: boolean) {
    this.rightSidebarOpen = open
    if (open) {
      this.leftSidebarOpen = false
      this.mobileConsoleOpen = false
    }
  }
}

export const uiStore = new UIStore()
