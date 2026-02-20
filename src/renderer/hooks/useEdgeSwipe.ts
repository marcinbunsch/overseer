import { useCallback, useRef } from "react"

interface UseEdgeSwipeOptions {
  /** Callback when swiping left from right edge */
  onSwipeLeft?: () => void
  /** Callback when swiping right from left edge */
  onSwipeRight?: () => void
  /** How close to edge touch must start (default: 30px) */
  edgeThreshold?: number
  /** Minimum swipe distance to trigger (default: 50px) */
  minSwipeDistance?: number
}

/**
 * Hook to detect horizontal swipe gestures from screen edges.
 * Useful for mobile navigation patterns like opening sidebars.
 *
 * @example
 * const { onTouchStart, onTouchEnd } = useEdgeSwipe({
 *   onSwipeRight: () => openLeftSidebar(),
 *   onSwipeLeft: () => openRightSidebar(),
 * })
 *
 * return <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>...</div>
 */
export function useEdgeSwipe({
  onSwipeLeft,
  onSwipeRight,
  edgeThreshold = 30,
  minSwipeDistance = 50,
}: UseEdgeSwipeOptions) {
  const touchStart = useRef<{
    x: number
    y: number
    fromEdge: "left" | "right" | null
  } | null>(null)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const screenWidth = window.innerWidth

      let fromEdge: "left" | "right" | null = null
      if (touch.clientX < edgeThreshold) {
        fromEdge = "left"
      } else if (touch.clientX > screenWidth - edgeThreshold) {
        fromEdge = "right"
      }

      touchStart.current = { x: touch.clientX, y: touch.clientY, fromEdge }
    },
    [edgeThreshold]
  )

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return

      const touch = e.changedTouches[0]
      const deltaX = touch.clientX - touchStart.current.x
      const deltaY = touch.clientY - touchStart.current.y

      // Only trigger if horizontal swipe is dominant
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
        if (touchStart.current.fromEdge === "left" && deltaX > 0) {
          onSwipeRight?.()
        } else if (touchStart.current.fromEdge === "right" && deltaX < 0) {
          onSwipeLeft?.()
        }
      }

      touchStart.current = null
    },
    [minSwipeDistance, onSwipeLeft, onSwipeRight]
  )

  return { onTouchStart, onTouchEnd }
}
