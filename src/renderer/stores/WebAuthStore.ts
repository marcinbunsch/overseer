/**
 * Store for managing web authentication state.
 *
 * Tracks whether authentication is required when connecting to an
 * Overseer HTTP server with authentication enabled.
 */
import { observable, action, makeObservable } from "mobx"

class WebAuthStore {
  @observable authRequired = false

  constructor() {
    makeObservable(this)
  }

  @action
  setAuthRequired(required: boolean): void {
    this.authRequired = required
  }
}

export const webAuthStore = new WebAuthStore()
