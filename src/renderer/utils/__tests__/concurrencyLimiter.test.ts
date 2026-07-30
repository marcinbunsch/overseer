import { describe, it, expect } from "vitest"
import { createConcurrencyLimiter } from "../concurrencyLimiter"

/** A promise plus its resolve handle, for driving task completion by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("createConcurrencyLimiter", () => {
  it("never exceeds the concurrency cap", async () => {
    const run = createConcurrencyLimiter(3)
    let active = 0
    let peak = 0
    const gates = Array.from({ length: 10 }, () => deferred<void>())

    const tasks = gates.map((gate, i) =>
      run(async () => {
        active++
        peak = Math.max(peak, active)
        await gate.promise
        active--
        return i
      })
    )

    // Let the initial batch start.
    await Promise.resolve()
    expect(active).toBe(3)

    // Release gates one at a time; a freed slot pulls the next queued task.
    for (const gate of gates) {
      gate.resolve()
      await Promise.resolve()
    }

    await Promise.all(tasks)
    expect(peak).toBe(3)
  })

  it("runs every task and resolves with each result in order", async () => {
    const run = createConcurrencyLimiter(2)
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => run(async () => n * 2)))
    expect(results).toEqual([2, 4, 6, 8, 10])
  })

  it("propagates rejections and still drains the queue", async () => {
    const run = createConcurrencyLimiter(1)
    const outcomes: string[] = []

    const a = run(async () => {
      throw new Error("boom")
    }).catch((e: Error) => outcomes.push(`rejected:${e.message}`))
    const b = run(async () => {
      outcomes.push("ran:b")
    })

    await Promise.all([a, b])
    expect(outcomes).toEqual(["rejected:boom", "ran:b"])
  })

  it("normalizes a synchronous throw into a rejected promise", async () => {
    const run = createConcurrencyLimiter(2)
    await expect(
      run(() => {
        throw new Error("sync throw")
      })
    ).rejects.toThrow("sync throw")

    // Queue is not wedged after a sync throw.
    await expect(run(async () => "ok")).resolves.toBe("ok")
  })
})
