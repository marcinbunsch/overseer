import { observable, action, computed, makeObservable, runInAction } from "mobx"
import { invoke } from "@tauri-apps/api/core"

class DebugStore {
  @observable isDebugMode: boolean = false
  @observable isDemoMode: boolean = false
  @observable loaded: boolean = false

  // Dev mode is only true when running with `pnpm dev` (Vite dev server)
  // This is different from debug mode which can be enabled via OVERSEER_DEBUG
  readonly isDevMode: boolean = import.meta.env.DEV

  constructor() {
    makeObservable(this)
    this.load()
  }

  // Show dev UI chrome (yellow banner, borders, debug buttons) only if:
  // - Running in dev mode AND
  // - NOT in demo mode (OVERSEER_DEMO env var)
  @computed
  get showDevUI(): boolean {
    return this.isDevMode && !this.isDemoMode
  }

  @action
  async load(): Promise<void> {
    if (this.loaded) return
    try {
      const [isDebug, isDemo] = await Promise.all([
        invoke<boolean>("is_debug_mode"),
        invoke<boolean>("is_demo_mode"),
      ])
      runInAction(() => {
        // Enable debug mode if OVERSEER_DEBUG is set OR if running in dev mode
        this.isDebugMode = isDebug || import.meta.env.DEV
        this.isDemoMode = isDemo
        this.loaded = true
      })
    } catch {
      runInAction(() => {
        // Fall back to dev mode check if invoke fails
        this.isDebugMode = import.meta.env.DEV
        this.isDemoMode = false
        this.loaded = true
      })
    }
  }
}

export const debugStore = new DebugStore()
