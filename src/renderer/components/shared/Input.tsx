import classNames from "classnames"
import { forwardRef } from "react"

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    autoComplete="off"
    autoCorrect="off"
    autoCapitalize="off"
    spellCheck={false}
    className={classNames("ovr-input", className)}
    {...props}
  />
))
Input.displayName = "Input"
