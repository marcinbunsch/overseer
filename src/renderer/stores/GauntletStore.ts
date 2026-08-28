import { observable, action, makeObservable, computed } from "mobx"
import type { GauntletReviewer } from "../types"

/**
 * The reviewers seeded on a fresh install. Each is a specialist review pass;
 * a gauntlet run fans out to every enabled reviewer in parallel and the
 * implementer must address all their findings to survive.
 */
const CODE_REVIEW_PROMPT = `Review the work for **correctness** — whether the code does the right thing. Ignore style and formatting; a separate reviewer owns that.

Check for:
- **Meets the goal**: the change actually does what the task asked, with nothing half-finished or stubbed out.
- **Logic errors**: off-by-one, inverted conditions, wrong operator, bad boolean logic, incorrect control flow.
- **Edge cases**: empty/null/undefined inputs, zero and negative numbers, empty collections, single-element cases, very large inputs, duplicate keys.
- **Error handling**: failures that are swallowed, unhandled rejections/exceptions, missing checks on operations that can fail (I/O, network, parsing).
- **State and async**: race conditions, stale closures, unawaited promises, mutation of shared state, effects that fire at the wrong time or don't clean up.
- **Data integrity**: type coercion surprises, boundary conditions, incorrect data transformations, lost precision.
- **Regressions**: existing callers or behavior this change could break.
- **Tests**: whether new behavior is covered and whether the tests actually assert the right thing (not just that code runs).

Trace at least one realistic path end to end rather than reading in isolation. For each finding, give a concrete failing scenario (specific inputs → wrong output or crash) and cite file:line. Rank by severity: crashes and wrong results first, then unhandled edge cases, then missing coverage.`

const CODE_QUALITY_PROMPT = `Review the work for **code quality and maintainability**, not correctness — assume the logic works and ask whether the next person can safely change it. Do not re-report functional bugs; that is another reviewer's job.

Check for:
- **Readability**: unclear names, misleading names, dense or deeply nested logic, magic numbers/strings, comments that explain *what* instead of *why* (or contradict the code).
- **Structure**: functions doing too much, wrong layer/module for a piece of logic, leaky abstractions, tight coupling, missing separation of concerns.
- **Duplication**: copy-pasted logic that should be shared, and — just as important — premature abstraction that adds indirection without payoff.
- **Consistency**: does this match the patterns, naming, and conventions already used in the surrounding code and the repo's guidelines?
- **Dead weight**: unused variables/imports/exports, unreachable code, commented-out blocks, leftover debug logging, TODOs left dangling.
- **Simplicity**: places where the same result could be reached with clearly less code or fewer moving parts.
- **Tests as code**: test readability, brittle assertions, over-mocking, missing cases for the behavior that was added.

Weigh findings by how much they'll cost future maintainers. Prefer concrete rewrites ("extract X", "rename Y to Z", "this branch is unreachable") over vague advice, and cite file:line. Distinguish must-fix from nice-to-have — don't manufacture nitpicks to look thorough.`

const SECURITY_REVIEW_PROMPT = `Review the work for **security vulnerabilities**. Report concrete, exploitable problems introduced or exposed by this change — not hypotheticals or generic hardening wishlists.

Check for:
- **Injection**: SQL/NoSQL, command/shell, path traversal, template/SSTI, and any place untrusted input reaches an interpreter, a shell, a query, or the filesystem.
- **Input validation**: unvalidated or unsanitized user/external input, missing bounds checks, unsafe deserialization, prototype pollution.
- **AuthN/AuthZ**: missing or incorrect authentication/authorization checks, privilege escalation, insecure direct object references, trusting client-supplied identity.
- **Secrets**: hard-coded credentials, API keys or tokens in code/logs/errors, secrets committed to config, secrets held in memory longer than needed.
- **Data exposure**: sensitive data in logs or error messages, overly broad responses, missing redaction, PII handling.
- **Injection into output**: XSS (stored/reflected/DOM), unsafe HTML rendering, unescaped output.
- **Dependencies & config**: newly added dependencies with known issues or excessive scope, insecure defaults, disabled TLS/verification, permissive CORS, dangerous file permissions.
- **Crypto & randomness**: weak or misused crypto, predictable tokens, non-cryptographic randomness used for security.

For each finding, describe the attack: who the attacker is, the input they control, and what they achieve (data read, code run, auth bypassed). Cite file:line and rate severity (critical/high/medium/low). If you find nothing exploitable, say so plainly rather than padding with theoretical risks.`

function defaultReviewers(): GauntletReviewer[] {
  return [
    {
      id: crypto.randomUUID(),
      name: "Code Review",
      prompt: CODE_REVIEW_PROMPT,
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Code Quality Assurance",
      prompt: CODE_QUALITY_PROMPT,
      agentType: "claude",
      modelVersion: null,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Security Review",
      prompt: SECURITY_REVIEW_PROMPT,
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
   * Seeds the defaults only when the config key is absent (fresh install) —
   * an explicit empty array means the user deleted every reviewer, which we honor.
   */
  @action
  initFromConfig(configs: GauntletReviewer[] | undefined): void {
    this._reviewers.clear()
    const list = configs ?? defaultReviewers()
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
