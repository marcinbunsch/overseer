import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X } from "lucide-react"

interface MermaidDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The already-rendered SVG markup, reused from the inline diagram. */
  svg: string
}

/**
 * Near-fullscreen dialog that shows a Mermaid diagram as large as the window
 * allows. Reuses the SVG the inline diagram already rendered, so opening it
 * costs nothing extra. Same AlertDialog layout as DiffDialog: full-bleed on
 * mobile, a small inset on desktop.
 */
export function MermaidDialog({ open, onOpenChange, svg }: MermaidDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content className="fixed inset-0 z-50 flex flex-col overflow-hidden border-ovr-border-subtle bg-ovr-bg-panel shadow-ovr-panel md:inset-6 md:rounded-xl md:border">
          <div className="flex items-center justify-between border-b border-ovr-border-subtle px-4 py-3">
            <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
              Diagram
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <button
                aria-label="Close"
                className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
              >
                <X size={16} />
              </button>
            </AlertDialog.Cancel>
          </div>

          {/* The SVG scales to fill this box; its viewBox keeps the aspect ratio. */}
          <div
            data-testid="mermaid-dialog-diagram"
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-ovr-bg-app p-4 [&>svg]:h-full [&>svg]:w-full [&>svg]:!max-w-none"
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          <AlertDialog.Description className="sr-only">
            Enlarged view of the Mermaid diagram.
          </AlertDialog.Description>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
