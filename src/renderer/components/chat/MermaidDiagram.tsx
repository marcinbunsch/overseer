import { useEffect, useId, useState } from "react"
import { observer } from "mobx-react-lite"
import type { Mermaid } from "mermaid"
import { themeController } from "../../services/themeController"
import { MermaidDialog } from "./MermaidDialog"

/** Lazy-loaded singleton so the ~large mermaid bundle stays out of the main chunk. */
let mermaidPromise: Promise<Mermaid> | null = null

function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default
      // suppressErrorRendering: a failed parse must not inject error DOM into <body>.
      mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true })
      return mermaid
    })
  }
  return mermaidPromise
}

/**
 * Renders a ```mermaid fenced block as an SVG diagram.
 *
 * During streaming the source arrives token by token and is invalid mermaid until
 * complete, so we validate with parse() and fall back to showing the raw source as
 * a code block until it parses. Re-renders on theme change to match light/dark.
 */
export const MermaidDiagram = observer(function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const effectiveTheme = themeController.effectiveTheme

  // Mermaid requires a valid DOM-id; useId() contains ':' which is invalid, so strip it.
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`

  useEffect(() => {
    // Guards against a slower earlier render (from a previous code/theme value)
    // overwriting a newer one — streaming emits many rapid updates.
    let cancelled = false

    async function render() {
      try {
        const mermaid = await getMermaid()
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: effectiveTheme === "light" ? "default" : "dark",
        })
        // parse() throws on invalid/incomplete source (expected mid-stream).
        await mermaid.parse(code)
        if (cancelled) return
        const result = await mermaid.render(renderId, code)
        if (cancelled) return
        setSvg(result.svg)
      } catch {
        // Incomplete or malformed diagram — show the raw source instead.
        if (!cancelled) setSvg(null)
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [code, effectiveTheme, renderId])

  if (svg) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          title="Click to enlarge"
          className="my-2 flex w-full cursor-zoom-in justify-center overflow-x-auto"
          data-testid="mermaid-diagram"
          // Trusted SVG produced by the local mermaid library from input we control.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <MermaidDialog open={dialogOpen} onOpenChange={setDialogOpen} svg={svg} />
      </>
    )
  }

  return (
    <pre
      className="my-2 overflow-x-auto rounded-md bg-ovr-bg-elevated p-3 text-sm"
      data-testid="mermaid-fallback"
    >
      <code>{code}</code>
    </pre>
  )
})
