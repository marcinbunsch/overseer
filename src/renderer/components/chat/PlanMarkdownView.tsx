import { memo, useCallback, useEffect, useRef, useState } from "react"
import { observer } from "mobx-react-lite"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { MessageSquare } from "lucide-react"
import Highlighter from "@plannotator/web-highlighter"
import type HighlightSource from "@plannotator/web-highlighter/dist/model/source"
import { MarkdownLink, MarkdownCode } from "./markdownComponents"
import { rehypeSourceLines } from "./rehypeSourceLines"
import { rehypeStripBlockWhitespace } from "./rehypeStripBlockWhitespace"
import { lineRangeFromMarks, unionRect } from "./planSelection"
import { PlanSelectionPopover, type PopoverPhase } from "./PlanSelectionPopover"
import type { PlanReviewStore } from "../../stores/PlanReviewStore"

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeStripBlockWhitespace, rehypeSourceLines]
const MARKDOWN_COMPONENTS: Components = { a: MarkdownLink, code: MarkdownCode }

// web-highlighter puts this class on every mark; committed notes also get COMMITTED_CLASS.
const MARK_CLASS = "plan-mark"
const COMMITTED_CLASS = "committed"

interface PlanMarkdownViewProps {
  planContent: string
  notesStore: PlanReviewStore
}

interface PreviewDraft {
  source: HighlightSource
  anchorEl: HTMLElement
  phase: PopoverPhase
  comment: string
}

export const PlanMarkdownView = observer(function PlanMarkdownView({
  planContent,
  notesStore,
}: PlanMarkdownViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const highlighterRef = useRef<Highlighter | null>(null)
  const [draft, setDraft] = useState<PreviewDraft | null>(null)
  // The CREATE handler is registered once; it reads the live draft through this ref.
  const draftRef = useRef<PreviewDraft | null>(null)
  draftRef.current = draft

  // Initialise web-highlighter once. It captures selections, paints the exact text in
  // <mark> spans, and serialises each to a DOM-independent anchor.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const highlighter = new Highlighter({
      $root: container,
      exceptSelectors: ["a"],
      wrapTag: "mark",
      style: { className: MARK_CLASS },
    })
    highlighterRef.current = highlighter

    highlighter.on(Highlighter.event.CREATE, ({ sources, type }) => {
      // Ignore programmatic restores (fromStore) — only real user selections open a comment.
      if (String(type) === "from-store") return
      const source = sources[0]
      if (!source) return
      const marks = highlighter.getDoms(source.id)
      if (marks.length === 0) return

      // Replace any previous unsubmitted selection, and drop the native selection so only
      // our mark is shown (one highlight, focus-independent).
      const previous = draftRef.current
      if (previous) highlighter.remove(previous.source.id)
      window.getSelection()?.removeAllRanges()

      setDraft({ source, anchorEl: marks[0], phase: "button", comment: "" })
    })

    highlighter.run()
    return () => highlighter.dispose()
  }, [])

  // Reconcile committed marks off the store: repaint any that aren't in the DOM (idempotent)
  // and remove marks for notes that were deleted (e.g. from the sidebar).
  const committedIds = notesStore.notes
    .filter((note) => note.anchor)
    .map((note) => note.id)
    .join(",")
  const paintedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const highlighter = highlighterRef.current
    if (!highlighter) return

    const current = new Set<string>()
    for (const note of notesStore.notes) {
      if (!note.anchor) continue
      current.add(note.id)
      if (highlighter.getDoms(note.id).length === 0) {
        highlighter.fromStore(
          note.anchor.startMeta,
          note.anchor.endMeta,
          note.selectedText ?? "",
          note.id
        )
      }
      highlighter.addClass(COMMITTED_CLASS, note.id)
    }
    for (const id of paintedIdsRef.current) {
      if (!current.has(id)) highlighter.remove(id)
    }
    paintedIdsRef.current = current
    // committedIds is the signature that drives this; notes is read through the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedIds])

  const handleStartComment = useCallback(() => {
    setDraft((current) => (current ? { ...current, phase: "editor" } : null))
  }, [])

  const handleChangeComment = useCallback((text: string) => {
    setDraft((current) => (current ? { ...current, comment: text } : null))
  }, [])

  const handleSubmit = useCallback(() => {
    const highlighter = highlighterRef.current
    if (!draft || !highlighter || !draft.comment.trim()) return

    const marks = highlighter.getDoms(draft.source.id)
    const lineRange = lineRangeFromMarks(marks) ?? { startLine: 1, endLine: 1 }
    notesStore.addPreviewNote({
      id: draft.source.id,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      selectedText: draft.source.text,
      comment: draft.comment,
      anchor: { startMeta: draft.source.startMeta, endMeta: draft.source.endMeta },
    })
    highlighter.addClass(COMMITTED_CLASS, draft.source.id)
    setDraft(null)
  }, [draft, notesStore])

  const handleCancel = useCallback(() => {
    if (draft) highlighterRef.current?.remove(draft.source.id)
    setDraft(null)
  }, [draft])

  // Read live so the popover can re-anchor to the selection as the preview scrolls.
  const getAnchorRect = useCallback(
    () => (draft ? selectionRect(highlighterRef.current, draft) : new DOMRect()),
    [draft]
  )

  return (
    <>
      <div ref={containerRef} className="relative min-h-full cursor-text p-4">
        {notesStore.hasNotes && (
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-ovr-amber-500/20 px-2 py-1 text-xs text-ovr-amber-400">
            <MessageSquare size={12} />
            <span>
              {notesStore.notes.length} comment{notesStore.notes.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        <PlanProse markdown={planContent} />
        <div className="mt-4 text-center text-xs text-ovr-text-dim">
          Select text to comment on it.
        </div>
      </div>

      {draft && (
        <PlanSelectionPopover
          getAnchorRect={getAnchorRect}
          phase={draft.phase}
          commentText={draft.comment}
          onStartComment={handleStartComment}
          onChangeComment={handleChangeComment}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </>
  )
})

/** The viewport box of the draft's highlight marks, for anchoring the popover. */
function selectionRect(highlighter: Highlighter | null, draft: PreviewDraft): DOMRect {
  const marks = highlighter?.getDoms(draft.source.id) ?? []
  return unionRect(marks.length > 0 ? marks : [draft.anchorEl])
}

/**
 * The rendered plan prose. Memoised on the markdown so it renders once and never
 * reconciles — otherwise React would strip the <mark> spans web-highlighter injects.
 */
const PlanProse = memo(function PlanProse({ markdown }: { markdown: string }) {
  return (
    <div className="ovr-markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
})
