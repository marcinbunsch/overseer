import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import { GitPullRequest, GitMerge, PencilLine } from "lucide-react"
import { MarkdownLink, MarkdownCode } from "./markdownComponents"

interface MarkdownContentProps {
  content: string
  className?: string
}

interface ParsedAction {
  action: string
  params: Record<string, unknown>
}

function parseActionContent(content: string): ParsedAction | null {
  try {
    const parsed = JSON.parse(content) as { action?: string; params?: Record<string, unknown> }
    if (typeof parsed.action === "string" && typeof parsed.params === "object") {
      return { action: parsed.action, params: parsed.params ?? {} }
    }
    return null
  } catch {
    return null
  }
}

function getActionIcon(action: string) {
  switch (action) {
    case "open_pr":
      return <GitPullRequest size={14} />
    case "merge_branch":
      return <GitMerge size={14} />
    case "rename_chat":
      return <PencilLine size={14} />
    default:
      return null
  }
}

function getActionLabel(action: string, params: Record<string, unknown>) {
  switch (action) {
    case "open_pr":
      return `Open PR: ${params?.title ?? "Untitled"}`
    case "merge_branch":
      return `Merge into: ${params?.into ?? "unknown"}`
    case "rename_chat":
      return `Rename chat: ${params?.title ?? "Untitled"}`
    default:
      return `Action: ${action}`
  }
}

/** Render an overseer action block with a nice UI */
function OverseerActionBlock({ content }: { content: string }) {
  const parsed = parseActionContent(content)

  if (!parsed) {
    // If JSON parsing fails, just show as code
    return (
      <pre className="my-2 overflow-x-auto rounded-md bg-ovr-bg-elevated p-3 text-sm">
        <code>{content}</code>
      </pre>
    )
  }

  return (
    <div className="my-2 flex items-center gap-2 rounded-md border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2 text-sm text-ovr-text-muted">
      <span className="text-ovr-azure-400">{getActionIcon(parsed.action)}</span>
      <span>{getActionLabel(parsed.action, parsed.params)}</span>
    </div>
  )
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
}: MarkdownContentProps) {
  return (
    <div className={`ovr-markdown ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: MarkdownLink,
          code({ className: codeClassName, children, ...rest }) {
            const codeString = String(children).replace(/\n$/, "")
            const match = /language-(\w+)/.exec(codeClassName || "")

            // Special handling for overseer action blocks
            if (match && match[1] === "overseer") {
              return <OverseerActionBlock content={codeString} />
            }

            return (
              <MarkdownCode className={codeClassName} {...rest}>
                {children}
              </MarkdownCode>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
