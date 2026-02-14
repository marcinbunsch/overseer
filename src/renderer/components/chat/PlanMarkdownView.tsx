import { useCallback, useRef } from "react"
import { observer } from "mobx-react-lite"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { MessageSquare } from "lucide-react"
import { MarkdownLink, MarkdownCode } from "./markdownComponents"
import type { PlanReviewStore } from "../../stores/PlanReviewStore"

interface PlanMarkdownViewProps {
  planContent: string
  notesStore: PlanReviewStore
}

export const PlanMarkdownView = observer(function PlanMarkdownView({
  planContent,
  notesStore,
}: PlanMarkdownViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Map source positions to line numbers for notes
  const linesWithNotes = notesStore.linesWithNotes

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Find the target element and try to determine which line was clicked
      // We'll use a heuristic based on content matching
      const target = e.target as HTMLElement
      const text = target.textContent || ""

      // Find which line contains this text
      const lines = planContent.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(text.trim()) && text.trim().length > 0) {
          notesStore.switchToCodeAtLine(i)
          return
        }
      }

      // Fallback: switch to code view at line 0
      notesStore.switchToCodeAtLine(0)
    },
    [planContent, notesStore]
  )

  // Check if any notes exist to show indicator overlay
  const hasAnyNotes = notesStore.hasNotes

  return (
    <div
      ref={containerRef}
      className="relative min-h-full cursor-text p-4"
      onDoubleClick={handleDoubleClick}
      title="Double-click to switch to code view"
    >
      {hasAnyNotes && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-ovr-amber-500/20 px-2 py-1 text-xs text-ovr-amber-400">
          <MessageSquare size={12} />
          <span>
            {notesStore.notes.length} comment{notesStore.notes.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <div className="ovr-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: MarkdownLink,
            code: MarkdownCode,
            // Add visual indicators for lines with notes
            h1: ({ children, ...props }) => (
              <h1 {...props} className="relative">
                {children}
                <NoteIndicator
                  content={String(children)}
                  lines={planContent.split("\n")}
                  linesWithNotes={linesWithNotes}
                />
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 {...props} className="relative">
                {children}
                <NoteIndicator
                  content={String(children)}
                  lines={planContent.split("\n")}
                  linesWithNotes={linesWithNotes}
                />
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 {...props} className="relative">
                {children}
                <NoteIndicator
                  content={String(children)}
                  lines={planContent.split("\n")}
                  linesWithNotes={linesWithNotes}
                />
              </h3>
            ),
            li: ({ children, ...props }) => (
              <li {...props} className="relative">
                {children}
                <NoteIndicator
                  content={String(children)}
                  lines={planContent.split("\n")}
                  linesWithNotes={linesWithNotes}
                />
              </li>
            ),
            p: ({ children, ...props }) => (
              <p {...props} className="relative">
                {children}
                <NoteIndicator
                  content={String(children)}
                  lines={planContent.split("\n")}
                  linesWithNotes={linesWithNotes}
                />
              </p>
            ),
          }}
        >
          {planContent}
        </ReactMarkdown>
      </div>
      <div className="mt-4 text-center text-xs text-ovr-text-dim">
        Double-click anywhere to switch to code view and add comments
      </div>
    </div>
  )
})

// Helper component to show note indicator on elements that have notes
function NoteIndicator({
  content,
  lines,
  linesWithNotes,
}: {
  content: string
  lines: string[]
  linesWithNotes: Set<number>
}) {
  // Check if any line with a note matches this content
  const contentClean = content.trim()
  if (!contentClean) return null

  for (const lineIndex of linesWithNotes) {
    const line = lines[lineIndex] || ""
    // Check if the line content is contained in the element's content
    // This is a heuristic - markdown rendering combines/transforms content
    if (
      line.includes(contentClean) ||
      contentClean.includes(line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, ""))
    ) {
      return (
        <span className="absolute -left-5 top-1/2 -translate-y-1/2">
          <MessageSquare size={12} className="text-ovr-amber-500" />
        </span>
      )
    }
  }
  return null
}
