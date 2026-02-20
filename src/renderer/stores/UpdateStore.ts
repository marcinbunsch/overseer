import { observable, action, makeObservable, runInAction } from "mobx"
import type { Update } from "@tauri-apps/plugin-updater"
import { backend } from "../backend"

export interface UpdateInfo {
  version: string
  date: string | null
  body: string | null
}

class UpdateStore {
  @observable
  availableUpdate: UpdateInfo | null = null

  @observable
  isChecking = false

  @observable
  isDownloading = false

  @observable
  downloadProgress = 0

  @observable
  error: string | null = null

  @observable
  notificationDismissed = false

  private updateHandle: Update | null = null

  constructor() {
    makeObservable(this)
  }

  @action
  async checkForUpdates(showToast = true): Promise<void> {
    // Updates are only available in Tauri
    if (backend.type !== "tauri") return
    if (this.isChecking) return

    this.isChecking = true
    this.error = null

    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const update = await check()

      runInAction(() => {
        if (update) {
          this.availableUpdate = {
            version: update.version,
            date: update.date ?? null,
            body: update.body ?? null,
          }
          this.updateHandle = update

          if (showToast) {
            // Reset dismissed state when a new update is found
            this.notificationDismissed = false
          }
        } else {
          this.availableUpdate = null
          this.updateHandle = null
        }
        this.isChecking = false
      })
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : String(err)
        this.isChecking = false
      })
    }
  }

  @action
  dismissNotification(): void {
    this.notificationDismissed = true
  }

  // DEBUG: Simulate a fake update for testing UI
  @action
  simulateFakeUpdate(): void {
    this.availableUpdate = {
      version: "99.0.0",
      date: new Date().toISOString(),
      body: "This is a fake update for testing the UI. Click Install to see the error (no real update exists).",
    }
    this.updateHandle = null
    this.notificationDismissed = false
  }

  @action
  async downloadAndInstall(): Promise<void> {
    if (!this.updateHandle || this.isDownloading) return

    this.isDownloading = true
    this.downloadProgress = 0
    this.error = null

    try {
      await this.updateHandle.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          runInAction(() => {
            this.downloadProgress = 0
          })
        } else if (event.event === "Progress") {
          runInAction(() => {
            this.downloadProgress += event.data.chunkLength
          })
        } else if (event.event === "Finished") {
          runInAction(() => {
            this.downloadProgress = 100
          })
        }
      })

      // Relaunch the app after successful install
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    } catch (err) {
      runInAction(() => {
        this.error = err instanceof Error ? err.message : String(err)
        this.isDownloading = false
      })
    }
  }
}

export const updateStore = new UpdateStore()
