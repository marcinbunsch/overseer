import { observable, computed, action, makeObservable, runInAction } from "mobx"
import { backend } from "../backend"
import { toastStore } from "./ToastStore"
import type { OverdriveRun, RunStatus } from "../types"

/** Statuses that need a human: review, blocked on input, or failed. */
const ACTIONABLE: RunStatus[] = ["needsReview", "needsInput", "failed"]

/** Statuses where a run is actively working (in flight). */
const IN_FLIGHT: RunStatus[] = ["provisioning", "harness", "redCheck", "working", "finalVerify"]

/**
 * Cross-repo store of Overdrive runs (the review inbox). Loads via
 * `overdrive_list_runs` and reloads on `overdrive:run-status` events.
 * Uses the default (local) backend since runs live on the machine running
 * the engine.
 */
class OverdriveRunStore {
  @observable runs: OverdriveRun[] = []

  @observable loading = false

  private unsub: (() => void) | null = null
  private started = false

  constructor() {
    makeObservable(this)
  }

  /** Load + subscribe once. Safe to call from every inbox mount. */
  start(): void {
    if (this.started) return
    this.started = true
    this.loadRuns()
    backend
      .listen("overdrive:run-status", () => this.loadRuns())
      .then((fn) => {
        this.unsub = fn
      })
  }

  /** Runs that need a human, newest first. */
  @computed get actionableRuns(): OverdriveRun[] {
    return this.runs.filter((r) => ACTIONABLE.includes(r.status))
  }

  @computed get actionableCount(): number {
    return this.actionableRuns.length
  }

  /**
   * Runs actively working, once they have a workspace to open (so they're
   * clickable). The single-flight engine means at most one at a time.
   */
  @computed get inFlightRuns(): OverdriveRun[] {
    return this.runs.filter((r) => IN_FLIGHT.includes(r.status) && !!r.workspacePath)
  }

  getRun(id: string): OverdriveRun | undefined {
    return this.runs.find((r) => r.id === id)
  }

  /** The run whose workspace is at `path`, if any (for the chat-header strip). */
  runForWorkspace(path: string | undefined): OverdriveRun | undefined {
    if (!path) return undefined
    return this.runs.find((r) => r.workspacePath === path)
  }

  async loadRuns(): Promise<void> {
    this.loading = true
    try {
      const runs = await backend.invoke<OverdriveRun[]>("overdrive_list_runs")
      runInAction(() => {
        this.runs = Array.isArray(runs) ? runs : []
      })
    } catch (err) {
      console.error("Failed to load Overdrive runs:", err)
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  /** Approve a run: mark the task complete (does not merge). */
  @action async approve(id: string): Promise<void> {
    try {
      await backend.invoke("overdrive_approve_run", { runId: id })
      toastStore.show("Task approved")
      this.loadRuns()
    } catch (err) {
      toastStore.show(String(err instanceof Error ? err.message : err) || "Approve failed")
    }
  }

  /** Reject a run (archive its workspace). */
  @action async reject(id: string): Promise<void> {
    try {
      await backend.invoke("overdrive_reject_run", { runId: id })
      toastStore.show("Run rejected")
      this.loadRuns()
    } catch (err) {
      toastStore.show(String(err instanceof Error ? err.message : err) || "Reject failed")
    }
  }

  dispose(): void {
    this.unsub?.()
    this.unsub = null
  }
}

export const overdriveRunStore = new OverdriveRunStore()
