import { useState, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Paperclip } from "lucide-react"
import { readFile } from "@tauri-apps/plugin-fs"
import type { Attachment } from "../../types"
import { backend } from "../../backend"
import { getAttachmentBlobUrl } from "../../services/attachmentService"

interface AttachmentChipProps {
  attachment: Attachment
  /** If provided, shows a remove button (for pending attachments before send) */
  onRemove?: () => void
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(
    getAttachmentBlobUrl(attachment.id) ?? null
  )
  const [loading, setLoading] = useState(false)
  const isImage = isImageMimeType(attachment.mimeType)

  // Cleanup blob URL on unmount (only if we created it ourselves via readFile)
  useEffect(() => {
    return () => {
      const cached = getAttachmentBlobUrl(attachment.id)
      if (imageUrl && !cached && imageUrl.startsWith("blob:")) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl, attachment.id])

  const handleClick = async () => {
    if (onRemove) return // Don't open when in pending/removable mode

    if (isImage) {
      // Load image data if not already available
      if (!imageUrl) {
        setLoading(true)
        try {
          const bytes = await readFile(attachment.path)
          const blob = new Blob([bytes], { type: attachment.mimeType })
          const url = URL.createObjectURL(blob)
          setImageUrl(url)
        } catch (err) {
          console.error("Failed to read attachment:", err)
        } finally {
          setLoading(false)
        }
      }
      setDialogOpen(true)
    } else {
      // Open non-image files with the system default handler
      await backend.invoke("open_external", {
        command: "open",
        path: attachment.path,
      })
    }
  }

  const chip = (
    <button
      type="button"
      onClick={handleClick}
      className="flex max-w-[160px] items-center gap-1.5 rounded border border-ovr-border-subtle bg-ovr-bg-elevated px-2 py-1 text-xs text-ovr-text-primary transition-colors hover:border-ovr-azure-500 hover:text-ovr-azure-400"
      title={attachment.filename}
      data-testid="attachment-chip"
    >
      <Paperclip size={12} className="shrink-0 text-ovr-text-muted" />
      <span className="truncate">{attachment.filename}</span>
      {onRemove && (
        <span
          role="button"
          className="ml-0.5 shrink-0 rounded text-ovr-text-muted hover:text-ovr-text-primary"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          data-testid="attachment-remove-button"
        >
          <X size={10} />
        </span>
      )}
    </button>
  )

  if (!isImage || onRemove) {
    return chip
  }

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <Dialog.Trigger asChild>{chip}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between border-b border-ovr-border-subtle px-4 py-3">
            <Dialog.Title className="text-sm font-medium text-ovr-text-primary">
              {attachment.filename}
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-ovr-text-muted hover:bg-ovr-bg-panel hover:text-ovr-text-primary">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="flex items-center justify-center p-4">
            {loading ? (
              <div className="text-sm text-ovr-text-muted">Loading...</div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={attachment.filename}
                className="max-h-[75vh] max-w-[85vw] object-contain"
              />
            ) : (
              <div className="text-sm text-ovr-text-muted">Failed to load image</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
