import classNames from "classnames"
import { forwardRef } from "react"

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} type="checkbox" className={classNames("ovr-checkbox", className)} {...props} />
  )
)
Checkbox.displayName = "Checkbox"
