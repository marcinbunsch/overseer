import classNames from "classnames"
import { forwardRef } from "react"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={classNames("ovr-textarea", className)}
      {...props}
    />
  )
)
Textarea.displayName = "Textarea"
