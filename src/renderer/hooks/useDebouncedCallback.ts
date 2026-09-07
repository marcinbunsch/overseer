import { DependencyList, useCallback, useEffect, useRef } from "react"

export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
  deps: DependencyList
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
      }, delay)
    },
    // deps is caller-provided and spread intentionally; it can't be statically checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [callback, delay, ...deps]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return debouncedCallback as T
}
