import { observable, action, makeObservable, runInAction } from "mobx"
import { invoke } from "@tauri-apps/api/core"

class DebugStore {
  @observable isDebugMode: boolean = false
  @observable loaded: boolean = false

  // Dev mode is only true when running with `pnpm dev` (Vite dev server)
  // This is different from debug mode which can be enabled via OVERSEER_DEBUG
  readonly isDevMode: boolean = import.meta.env.DEV

  constructor() {
    makeObservable(this)
    this.load()
  }

  @action
  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const isDebug = await invoke<boolean>("is_debug_mode")
      runInAction(() => {
        // Enable debug mode if OVERSEER_DEBUG is set OR if running in dev mode
        this.isDebugMode = isDebug || import.meta.env.DEV
        this.loaded = true
      })
    } catch {
      runInAction(() => {
        // Fall back to dev mode check if invoke fails
        this.isDebugMode = import.meta.env.DEV
        this.loaded = true
      })
    }
  }
}

export const debugStore = new DebugStore()
