import { observable, action, makeObservable } from "mobx"
import { terminalService } from "../services/terminal"

class TerminalStore {
  @observable currentWorkspacePath: string | null = null
  @observable isConnected: boolean = false

  constructor() {
    makeObservable(this)
  }

  @action openTerminal(workspacePath: string): void {
    this.currentWorkspacePath = workspacePath
    this.isConnected = true
  }

  @action closeTerminal(): void {
    // Destroy the terminal if user never interacted with it
    if (this.currentWorkspacePath) {
      terminalService.destroyIfUnused(this.currentWorkspacePath)
    }
    this.currentWorkspacePath = null
    this.isConnected = false
  }

  @action destroyTerminal(workspacePath: string): void {
    terminalService.destroy(workspacePath)
    if (this.currentWorkspacePath === workspacePath) {
      this.currentWorkspacePath = null
      this.isConnected = false
    }
  }
}

export const terminalStore = new TerminalStore()
