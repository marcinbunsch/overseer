import { observer } from "mobx-react-lite"
import { useEffect, useRef } from "react"
import { terminalService, TERMINAL_THEME, type TerminalInstance } from "../../services/terminal"
import "xterm/css/xterm.css"

interface TerminalPaneProps {
  workspacePath: string
  workspaceRoot?: string
}

export const TerminalPane = observer(function TerminalPane({
  workspacePath,
  workspaceRoot,
}: TerminalPaneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<TerminalInstance | null>(null)

  useEffect(() => {
    if (!wrapperRef.current) return

    const wrapper = wrapperRef.current
    let mounted = true

    const init = async () => {
      const instance = await terminalService.getOrCreate(workspacePath, workspaceRoot)
      if (!mounted) return

      instanceRef.current = instance
      wrapper.appendChild(instance.containerEl)

      // Double rAF: first frame the element is in the DOM and laid out,
      // second frame ensures the flex layout has resolved final dimensions
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!mounted || !instanceRef.current) return
          instance.fitAddon.fit()
          terminalService.resize(workspacePath, instance.xterm.cols, instance.xterm.rows)
          // Refresh the terminal to ensure proper rendering after reattachment
          instance.xterm.refresh(0, instance.xterm.rows - 1)
        })
      })
    }

    init()

    const resizeObserver = new ResizeObserver(() => {
      const instance = instanceRef.current
      if (!instance) return
      instance.fitAddon.fit()
      terminalService.resize(workspacePath, instance.xterm.cols, instance.xterm.rows)
    })
    resizeObserver.observe(wrapper)

    return () => {
      mounted = false
      resizeObserver.disconnect()
      const instance = instanceRef.current
      if (instance && wrapper.contains(instance.containerEl)) {
        wrapper.removeChild(instance.containerEl)
      }
      instanceRef.current = null
    }
  }, [workspacePath, workspaceRoot])

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: TERMINAL_THEME.background }}
    />
  )
})
