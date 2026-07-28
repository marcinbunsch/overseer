import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { MessageSquarePlus } from "lucide-react"

export type PopoverPhase = "button" | "editor"

interface PlanSelectionPopoverProps {
  /**
   * Reads the current bounding rect of the whole selection, in viewport coordinates.
   * A callback (not a static rect) so the popover can re-read it on scroll/resize.
   */
  getAnchorRect: () => DOMRect
  phase: PopoverPhase
  commentText: string
  /** "button" phase: user clicked the floating Comment trigger. */
  onStartComment: () => void
  onChangeComment: (text: string) => void
  onSubmit: () => void
  onCancel: () => void
}

const GAP = 6 // space between the selection and the popover
const MARGIN = 8 // minimum gap from the viewport edge

interface AnchorBox {
  top: number
  left: number
  width: number
  bottom: number
}

/**
 * Places the popover centered under the selection, flipped above it when there isn't room
 * below, and clamped inside the viewport. Measured against the popover's real size so the
 * flip and clamp use its actual height/width.
 */
function computePosition(anchor: AnchorBox, self: DOMRect): { top: number; left: number } {
  const spaceBelow = window.innerHeight - anchor.bottom
  const placeAbove = spaceBelow < self.height + GAP + MARGIN
  const top = placeAbove ? anchor.top - GAP - self.height : anchor.bottom + GAP
  const left = anchor.left + anchor.width / 2 - self.width / 2

  return {
    top: Math.max(MARGIN, top),
    left: Math.max(MARGIN, Math.min(left, window.innerWidth - self.width - MARGIN)),
  }
}

/**
 * Floating popover anchored to a text selection in the plan preview. First shows a
 * "Comment" button next to the selection; clicking it swaps to an inline comment editor.
 */
export function PlanSelectionPopover({
  getAnchorRect,
  phase,
  commentText,
  onStartComment,
  onChangeComment,
  onSubmit,
  onCancel,
}: PlanSelectionPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const reposition = useCallback(() => {
    const el = rootRef.current
    if (el) setPosition(computePosition(getAnchorRect(), el.getBoundingClientRect()))
  }, [getAnchorRect])

  // Position after render so the popover's measured size drives the flip/clamp. Re-runs when
  // the selection changes (getAnchorRect identity) or the phase (and thus the size) changes.
  useLayoutEffect(() => {
    reposition()
  }, [reposition, phase])

  // The preview scrolls in an overflow container, so keep the popover pinned to the
  // selection. Capture-phase scroll catches the inner container (scroll doesn't bubble).
  useEffect(() => {
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [reposition])

  // Clicking outside dismisses the popover (Cancel), which also clears the highlight.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onCancel()
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [onCancel])

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        zIndex: 60,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {phase === "button" ? (
        <button
          data-testid="plan-selection-comment-btn"
          onClick={onStartComment}
          className="flex items-center gap-1 rounded-md border border-ovr-border-subtle bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary shadow-ovr-panel transition-colors hover:border-ovr-azure-500/50 hover:text-ovr-azure-400"
        >
          <MessageSquarePlus size={12} />
          <span>Comment</span>
        </button>
      ) : (
        <CommentEditor
          commentText={commentText}
          onChangeComment={onChangeComment}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

interface CommentEditorProps {
  commentText: string
  onChangeComment: (text: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function CommentEditor({ commentText, onChangeComment, onSubmit, onCancel }: CommentEditorProps) {
  return (
    <div
      data-testid="plan-selection-comment-editor"
      style={{ width: 320 }}
      className="flex flex-col gap-2 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated p-2 shadow-ovr-panel"
    >
      <CommentTextarea
        value={commentText}
        onChange={onChangeComment}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="ovr-btn-ghost cursor-pointer px-2 py-1 text-xs">
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={!commentText.trim()}
          className="ovr-btn-primary cursor-pointer px-2 py-1 text-xs disabled:opacity-50"
        >
          Add Comment
        </button>
      </div>
    </div>
  )
}

interface CommentTextareaProps {
  value: string
  onChange: (text: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function CommentTextarea({ value, onChange, onSubmit, onCancel }: CommentTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <textarea
      ref={ref}
      data-testid="plan-selection-comment-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          onSubmit()
        }
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
      placeholder="Comment on the selected text..."
      rows={3}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className="resize-none overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted focus:border-ovr-azure-500 focus:shadow-[var(--shadow-ovr-glow-soft)]"
    />
  )
}
