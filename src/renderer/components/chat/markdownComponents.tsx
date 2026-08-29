import { observer } from "mobx-react-lite"
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism"
import { open } from "@tauri-apps/plugin-shell"
import { themeController } from "../../services/themeController"

/** Link component that opens URLs in the default browser */
export function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (href) {
      open(href)
    }
  }
  return (
    <a href={href} onClick={handleClick} className="cursor-pointer">
      {children}
    </a>
  )
}

/** Code block component with syntax highlighting */
export const MarkdownCode = observer(function MarkdownCode({
  className,
  children,
  ...rest
}: {
  className?: string
  children?: React.ReactNode
}) {
  const match = /language-(\w+)/.exec(className || "")
  const codeString = String(children).replace(/\n$/, "")

  if (match) {
    return (
      <SyntaxHighlighter
        style={themeController.effectiveTheme === "light" ? oneLight : oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    )
  }

  return (
    <code className={className} {...rest}>
      {children}
    </code>
  )
})
