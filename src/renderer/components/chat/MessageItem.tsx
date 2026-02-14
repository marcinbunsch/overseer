import { observer } from "mobx-react-lite"
import { useState } from "react"
import { ChevronRight, ChevronDown } from "lucide-react"
import type { Message } from "../../types"
import {
  parseToolCall,
  BashToolItem,
  ReadToolItem,
  WriteToolItem,
  EditToolItem,
  GlobToolItem,
  GrepToolItem,
  GenericToolItem,
  TodoWriteToolItem,
  WebFetchToolItem,
  WebSearchToolItem,
  EnterPlanModeToolItem,
} from "./tools"
import { MarkdownContent } from "./MarkdownContent"

interface MessageItemProps {
  message: Message
  /** Render in compact style (smaller, dimmer) for work/thinking messages */
  compact?: boolean
}

const BASH_OUTPUT_LINE_THRESHOLD = 3
const BASH_OUTPUT_CHAR_THRESHOLD = 500

function MetaMessageItem({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-3 flex justify-end">
      <div className="max-w-[80%] overflow-hidden rounded-lg border-r-2 border-ovr-azure-500 bg-ovr-bg-elevated px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ovr-azure-400 transition hover:text-ovr-azure-300"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {message.meta!.label}
        </button>
        {expanded && (
          <div className="mt-2 text-sm text-white">
            <MarkdownContent content={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function BashOutputItem({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n")
  const lineCount = lines.length
  const charCount = content.length

  // Collapse if too many lines OR too many characters (handles long single-line JSON)
  const shouldCollapseByLines = lineCount > BASH_OUTPUT_LINE_THRESHOLD
  const shouldCollapseByChars = charCount > BASH_OUTPUT_CHAR_THRESHOLD
  const shouldCollapse = shouldCollapseByLines || shouldCollapseByChars

  if (!shouldCollapse) {
    return (
      <div className="py-0.5">
        <pre className="whitespace-pre-wrap font-mono text-xs text-ovr-text-dim">{content}</pre>
      </div>
    )
  }

  // Create preview: either first N lines, or first N chars (for long single lines)
  let preview: string
  let hiddenDescription: string

  if (shouldCollapseByLines) {
    // Multi-line: show first few lines
    preview = lines.slice(0, BASH_OUTPUT_LINE_THRESHOLD).join("\n")
    const hiddenLines = lineCount - BASH_OUTPUT_LINE_THRESHOLD
    hiddenDescription = `${hiddenLines} more line${hiddenLines === 1 ? "" : "s"}`
  } else {
    // Long single line: show first N chars
    preview = content.slice(0, BASH_OUTPUT_CHAR_THRESHOLD) + "..."
    const hiddenChars = charCount - BASH_OUTPUT_CHAR_THRESHOLD
    hiddenDescription = `${hiddenChars} more characters`
  }

  return (
    <div className="py-0.5">
      {expanded ? (
        <>
          <pre className="whitespace-pre-wrap font-mono text-xs text-ovr-text-dim">{content}</pre>
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 flex items-center gap-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
          >
            <ChevronDown size={12} />
            <span>Collapse output</span>
          </button>
        </>
      ) : (
        <>
          <pre className="overflow-hidden font-mono text-xs text-ovr-text-dim *:truncate *:whitespace-pre">
            {preview.split("\n").map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </pre>
          <button
            onClick={() => setExpanded(true)}
            className="mt-1 flex items-center gap-1 text-xs text-ovr-text-muted hover:text-ovr-text-primary"
          >
            <ChevronRight size={12} />
            <span>Show {hiddenDescription}</span>
          </button>
        </>
      )}
    </div>
  )
}

const compactTools: Record<string, React.ComponentType<{ tool: import("./tools").ToolCall }>> = {
  Bash: BashToolItem,
  Read: ReadToolItem,
  Write: WriteToolItem,
  Edit: EditToolItem,
  Glob: GlobToolItem,
  Grep: GrepToolItem,
  TodoWrite: TodoWriteToolItem,
  WebFetch: WebFetchToolItem,
  WebSearch: WebSearchToolItem,
  EnterPlanMode: EnterPlanModeToolItem,
}

export const MessageItem = observer(function MessageItem({ message, compact }: MessageItemProps) {
  const isUser = message.role === "user"
  const tool = !isUser ? parseToolCall(message.content) : null
  if (tool && message.toolMeta) {
    tool.toolMeta = message.toolMeta
  }

  if (isUser) {
    if (message.meta) {
      return <MetaMessageItem message={message} />
    }

    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[80%] overflow-hidden rounded-lg border-r-2 border-ovr-azure-500 bg-ovr-bg-elevated px-3 py-4 text-sm text-white">
          <MarkdownContent content={message.content} />
        </div>
      </div>
    )
  }

  // Cancelled message
  if (message.content === "[cancelled]") {
    return <div className="mb-3 py-1 text-xs font-medium text-ovr-bad">User cancelled</div>
  }

  // Bash output (from Codex command execution)
  if (message.isBashOutput) {
    return <BashOutputItem content={message.content} />
  }

  // Info message (e.g., rate limit notifications)
  if (message.isInfo) {
    return <div className="py-1 text-xs italic text-ovr-text-muted">{message.content}</div>
  }

  // Compact tool rendering for known tools
  const CompactComponent = tool ? compactTools[tool.toolName] : null
  if (tool && CompactComponent) {
    return (
      <div className="flex justify-start">
        <CompactComponent tool={tool} />
      </div>
    )
  }

  // Other tool calls get collapsible rendering
  if (tool) {
    return (
      <div className="mb-1 flex justify-start">
        <GenericToolItem tool={tool} />
      </div>
    )
  }

  // Plain assistant text
  if (compact) {
    return (
      <div className="py-0.5">
        <MarkdownContent content={message.content} className="text-xs text-ovr-text-dim" />
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="border-l-2 border-ovr-border-strong px-3 py-2 text-sm text-ovr-text-primary">
        <MarkdownContent content={message.content} />
      </div>
    </div>
  )
})
