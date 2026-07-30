/**
 * Minimal concurrency limiter (p-queue style, no dependency).
 *
 * Wrap work with the returned runner; at most `maxConcurrent` tasks run at once
 * and the rest wait in FIFO order. Each call resolves/rejects with its task's
 * result, so callers `await` it exactly like the unwrapped work. Tasks may be
 * sync or async — a sync return is wrapped in a promise and a sync throw becomes
 * a rejection, so the queue never wedges on a throwing task.
 *
 * `maxConcurrent` is clamped to at least 1; a value <= 0 would otherwise let no
 * task ever start.
 *
 * Used to cap the burst of reconnect catch-up fetches when many chats recover a
 * dropped WebSocket at the same moment.
 */
export type LimitedRunner = <T>(task: () => T | Promise<T>) => Promise<T>

export function createConcurrencyLimiter(maxConcurrent: number): LimitedRunner {
  // Floor fractions, and treat 0 / negative / NaN as 1 so the queue can drain.
  const limit = Math.max(1, Math.floor(maxConcurrent) || 1)
  let active = 0
  const queue: Array<() => void> = []

  const startNext = (): void => {
    if (active >= limit) return
    const start = queue.shift()
    if (!start) return
    active++
    start()
  }

  return function run<T>(task: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        // Normalize sync throws into a rejected promise so `finally` still runs.
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--
            startNext()
          })
      })
      startNext()
    })
  }
}
