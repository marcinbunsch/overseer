import { useState, useEffect, useRef, memo } from "react"
import { observer } from "mobx-react-lite"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { MessageSquare } from "lucide-react"
import type { ReactNode } from "react"
import type { PlanReviewStore } from "../../stores/PlanReviewStore"
import { ConfirmDialog } from "../shared/ConfirmDialog"

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[]; style?: React.CSSProperties }
  children?: HastNode[]
}

function resolveStyle(
  classNames: string[],
  stylesheet: Record<string, React.CSSProperties>
): React.CSSProperties {
  let style: React.CSSProperties = {}
  for (const cls of classNames) {
    if (cls !== "token" && stylesheet[cls]) {
      style = { ...style, ...stylesheet[cls] }
    }
  }
  return style
}

function renderNode(
  node: HastNode,
  key: number,
  stylesheet: Record<string, React.CSSProperties>
): ReactNode {
  if (node.type === "text") {
    return node.value?.replace(/\n$/, "") ?? ""
  }
  if (node.type === "element") {
    const classNames: string[] = node.properties?.className ?? []
    const style = { ...resolveStyle(classNames, stylesheet), ...(node.properties?.style ?? {}) }
    const children = node.children?.map((child, ci) => renderNode(child, ci, stylesheet))
    return (
      <span key={key} style={style}>
        {children}
      </span>
    )
  }
  return null
}

interface PlanContentTableProps {
  lines: string[]
  notesStore: PlanReviewStore
  onAddNote: () => void
}

export const PlanContentTable = observer(function PlanContentTable({
  lines,
  notesStore,
  onAddNote,
}: PlanContentTableProps) {
  const [isDragging, setIsDragging] = useState(false)

  const selectionStart = notesStore.selectionStart
  const selectionEnd = notesStore.selectionEnd
  const linesWithNotes = notesStore.linesWithNotes
  const highlightedLine = notesStore.highlightedLine

  const isLineSelected = (i: number) =>
    selectionStart !== null && selectionEnd !== null && i >= selectionStart && i <= selectionEnd

  const isLineHighlighted = (i: number) => highlightedLine === i

  const hasNoteOnLine = (i: number) => linesWithNotes.has(i)

  const handleLineMouseDown = (lineIndex: number, shiftKey: boolean) => {
    notesStore.startSelection(lineIndex, shiftKey)
    setIsDragging(true)
  }

  const handleLineMouseEnter = (lineIndex: number) => {
    if (!isDragging) return
    notesStore.extendSelection(lineIndex)
  }

  const handleLineMouseUp = () => {
    if (isDragging) {
      setIsDragging(false)
    }
  }

  // Global mouseup to handle drag ending outside line numbers
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false)
      }
    }
    window.addEventListener("mouseup", handleGlobalMouseUp)
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp)
  }, [isDragging])

  const handleCancel = () => {
    notesStore.discardPending()
  }

  const handleSubmit = () => {
    if (selectionStart === null || selectionEnd === null) return
    // Get the line content for the selected range
    const selectedLines = lines.slice(selectionStart, selectionEnd + 1)
    const lineContent = selectedLines.join("\n")
    // Convert to 1-based line numbers
    const startLine = selectionStart + 1
    const endLine = selectionEnd + 1
    notesStore.addNote(lineContent, startLine, endLine)
    onAddNote()
  }

  const handleClearSelection = () => {
    notesStore.discardPending()
  }

  // Pre-compute line range for the comment box (only when selection exists)
  let commentStartLine = 0
  let commentEndLine = 0
  if (selectionStart !== null && selectionEnd !== null) {
    commentStartLine = selectionStart + 1
    commentEndLine = selectionEnd + 1
  }

  // Show comment box when there's a pending note and not currently dragging
  const showCommentBox = notesStore.hasPendingNote && !isDragging

  const codeString = lines.join("\n")

  const renderRows = (syntaxHighlightedRows?: Map<number, ReactNode>) =>
    lines.flatMap((line, i) => {
      const row = (
        <PlanRow
          key={i}
          content={line}
          lineNumber={i + 1}
          lineIndex={i}
          isSelected={isLineSelected(i)}
          isHighlighted={isLineHighlighted(i)}
          hasNote={hasNoteOnLine(i)}
          onLineMouseDown={handleLineMouseDown}
          onLineMouseEnter={handleLineMouseEnter}
          onLineMouseUp={handleLineMouseUp}
          isDragging={isDragging}
          syntaxHighlighted={syntaxHighlightedRows?.get(i)}
        />
      )
      if (showCommentBox && i === selectionEnd) {
        return [
          row,
          <CommentRow
            key="comment-box"
            startLine={commentStartLine}
            endLine={commentEndLine}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onClearSelection={handleClearSelection}
            notesStore={notesStore}
          />,
        ]
      }
      return [row]
    })

  const tableColGroup = (
    <colgroup>
      <col className="w-12" />
      <col />
    </colgroup>
  )

  return (
    <SyntaxHighlighter
      language="markdown"
      style={oneDark}
      useInlineStyles={true}
      wrapLines={true}
      PreTag="div"
      customStyle={{ margin: 0, padding: 0, background: "transparent" }}
      codeTagProps={{ style: { background: "transparent" } }}
      renderer={({ rows, stylesheet }) => {
        const syntaxHighlightedRows = new Map<number, ReactNode>()
        rows.forEach((row, rowIdx) => {
          if (rowIdx < lines.length) {
            syntaxHighlightedRows.set(
              rowIdx,
              (row.children as HastNode[] | undefined)?.map((child, ci) =>
                renderNode(child, ci, stylesheet)
              )
            )
          }
        })

        return (
          <table className="w-full table-fixed border-collapse font-mono text-xs">
            {tableColGroup}
            <tbody>{renderRows(syntaxHighlightedRows)}</tbody>
          </table>
        )
      }}
    >
      {codeString}
    </SyntaxHighlighter>
  )
})

const CommentRow = observer(function CommentRow({
  startLine,
  endLine,
  onSubmit,
  onCancel,
  onClearSelection,
  notesStore,
}: {
  startLine: number
  endLine: number
  onSubmit: () => void
  onCancel: () => void
  onClearSelection: () => void
  notesStore: PlanReviewStore
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const commentText = notesStore.pending?.commentText ?? ""

  const handleEscape = () => {
    if (!commentText.trim()) {
      onClearSelection()
    } else {
      notesStore.showDiscardDialog = true
    }
  }

  const handleConfirmDiscard = () => {
    notesStore.showDiscardDialog = false
    onCancel()
  }

  const lineRef = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
  const isEditing = notesStore.isEditing

  return (
    <>
      <tr className="bg-ovr-bg-elevated">
        <td colSpan={2} className="px-3 py-2 font-sans">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-ovr-text-muted">
              <span>{lineRef}</span>
            </div>
            <textarea
              ref={textareaRef}
              value={commentText}
              onChange={(e) => notesStore.updateComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  handleEscape()
                }
              }}
              placeholder="Add a comment about the selected lines..."
              rows={1}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-h-20 resize-none overflow-y-auto rounded-lg border border-ovr-border-subtle bg-ovr-bg-panel px-3 py-2 text-sm text-ovr-text-primary outline-none placeholder:text-ovr-text-muted focus:border-ovr-azure-500 focus:shadow-[var(--shadow-ovr-glow-soft)]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  if (commentText.trim()) {
                    notesStore.showDiscardDialog = true
                  } else {
                    onClearSelection()
                  }
                }}
                className="ovr-btn-ghost cursor-pointer px-2 py-1 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                disabled={!commentText.trim()}
                className="ovr-btn-primary cursor-pointer px-2 py-1 text-xs disabled:opacity-50"
              >
                {isEditing ? "Save" : "Add Comment"}
              </button>
            </div>
          </div>
        </td>
      </tr>
      <ConfirmDialog
        open={notesStore.showDiscardDialog}
        onOpenChange={(open) => {
          notesStore.showDiscardDialog = open
        }}
        title="Discard comment?"
        description="You have unsaved comment text that will be lost."
        confirmLabel="Discard"
        onConfirm={handleConfirmDiscard}
      />
    </>
  )
})

interface PlanRowProps {
  content: string
  lineNumber: number
  lineIndex: number
  isSelected: boolean
  isHighlighted: boolean
  hasNote: boolean
  onLineMouseDown: (lineIndex: number, shiftKey: boolean) => void
  onLineMouseEnter: (lineIndex: number) => void
  onLineMouseUp: () => void
  isDragging: boolean
  syntaxHighlighted?: ReactNode
}

const PlanRow = memo(function PlanRow({
  content,
  lineNumber,
  lineIndex,
  isSelected,
  isHighlighted,
  hasNote,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseUp,
  isDragging,
  syntaxHighlighted,
}: PlanRowProps) {
  let rowClass = ""
  if (isSelected) {
    rowClass = "bg-ovr-azure-500/15 border-l-2 border-l-ovr-azure-500"
  } else if (isHighlighted) {
    // Lighter highlight for double-click navigation (no editor open)
    rowClass = "bg-ovr-azure-500/10 border-l-2 border-l-ovr-azure-400"
  } else if (hasNote) {
    rowClass = "bg-ovr-amber-500/10 border-l-2 border-l-ovr-amber-500"
  }

  const lineNumClass =
    "whitespace-nowrap border-r border-ovr-border-subtle px-2 py-0 text-right text-ovr-text-dim select-none cursor-pointer hover:text-ovr-azure-400 hover:bg-ovr-azure-500/10"

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    onLineMouseDown(lineIndex, e.shiftKey)
  }

  const handleMouseEnter = () => {
    onLineMouseEnter(lineIndex)
  }

  return (
    <tr className={rowClass}>
      <td
        className={lineNumClass}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseUp={onLineMouseUp}
      >
        <span className="flex items-center justify-end gap-1">
          {hasNote && <MessageSquare size={10} className="text-ovr-amber-500" />}
          {lineNumber}
        </span>
      </td>
      <td
        className={`whitespace-pre-wrap break-all px-3 py-0 text-ovr-text-primary ${isDragging ? "select-none" : ""}`}
      >
        {syntaxHighlighted ?? content}
      </td>
    </tr>
  )
})
