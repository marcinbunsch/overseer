import { observable, action, makeObservable, computed } from "mobx"
import type { GauntletReviewer } from "../types"

/**
 * The reviewers seeded on a fresh install. Each is a specialist review pass;
 * a gauntlet run fans out to every enabled reviewer in parallel and the
 * implementer must address all their findings to survive.
 */
function defaultReviewers(): GauntletReviewer[] {
  return [
    {
      id: crypto.randomUUID(),
      name: "Code Review",
      prompt:
        "Review the work for correctness. Look for bugs, broken edge cases, incorrect logic, " +
        "and whether the implementation actually meets the stated goal. Ignore style — focus on " +
        "whether the code does the right thing.",
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Code Quality Assurance",
      prompt:
        "Review the work for code quality, not correctness. Look at readability, structure, " +
        "naming, duplication, dead code, and test coverage. Flag anything that would make the " +
        "code harder to maintain.",
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Security Review",
      prompt:
        "Review the work for security problems. Look for injection, missing authorization, " +
        "unsafe handling of user input, leaked or hard-coded secrets, and risky dependencies. " +
        "Report concrete vulnerabilities, not hypotheticals.",
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    },
  ]
}

class GauntletStore {
  @observable
  private _reviewers: Map<string, GauntletReviewer> = new Map()

  constructor() {
    makeObservable(this)
  }

  @computed
  get reviewers(): GauntletReviewer[] {
    return Array.from(this._reviewers.values())
  }

  @computed
  get enabledReviewers(): GauntletReviewer[] {
    return this.reviewers.filter((r) => r.enabled)
  }

  /**
   * Initialize reviewers from saved config. Called by ConfigStore after loading.
   * Seeds the defaults when nothing is stored (fresh install).
   */
  @action
  initFromConfig(configs: GauntletReviewer[] | undefined): void {
    this._reviewers.clear()
    const list = configs && configs.length > 0 ? configs : defaultReviewers()
    for (const reviewer of list) {
      this._reviewers.set(reviewer.id, reviewer)
    }
  }

  @action
  addReviewer(config: Omit<GauntletReviewer, "id">): GauntletReviewer {
    const id = crypto.randomUUID()
    const reviewer: GauntletReviewer = { id, ...config }
    this._reviewers.set(id, reviewer)
    return reviewer
  }

  @action
  updateReviewer(id: string, updates: Partial<Omit<GauntletReviewer, "id">>): void {
    const reviewer = this._reviewers.get(id)
    if (!reviewer) return
    Object.assign(reviewer, updates)
  }

  @action
  removeReviewer(id: string): void {
    this._reviewers.delete(id)
  }

  getReviewer(id: string): GauntletReviewer | undefined {
    return this._reviewers.get(id)
  }

  /** Reviewer configs for persistence. */
  getConfigs(): GauntletReviewer[] {
    return this.reviewers.map(({ id, name, prompt, agentType, modelVersion, enabled }) => ({
      id,
      name,
      prompt,
      agentType,
      modelVersion,
      enabled,
    }))
  }
}

export const gauntletStore = new GauntletStore()
