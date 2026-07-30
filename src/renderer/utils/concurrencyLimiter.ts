/**
 * Minimal concurrency limiter (p-queue style, no dependency).
 *
 * Wrap async work with the returned runner; at most `maxConcurrent` tasks run
 * at once and the rest wait in FIFO order. Each call resolves/rejects with its
 * task's result, so callers `await` it exactly like the unwrapped work.
 *
 * Used to cap the burst of reconnect catch-up fetches when many chats recover a
 * dropped WebSocket at the same moment.
 */
export type LimitedRunner = <T>(task: () => Promise<T>) => Promise<T>

export function createConcurrencyLimiter(maxConcurrent: number): LimitedRunner {
  let active = 0
  const queue: Array<() => void> = []

  const startNext = (): void => {
    if (active >= maxConcurrent) return
    const start = queue.shift()
    if (!start) return
    active++
    start()
  }

  return function run<T>(task: () => Promise<T>): Promise<T> {
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
