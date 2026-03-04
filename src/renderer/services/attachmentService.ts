import { backend } from "../backend"
import type { Attachment } from "../types"

/**
 * Cache of blob URLs for attachments created in the current session.
 * These are created from the original File object and are valid for the lifetime of the page.
 */
const blobUrlCache = new Map<string, string>()

/**
 * Get a cached blob URL for an attachment created in the current session.
 * Returns undefined for attachments loaded from history.
 */
export function getAttachmentBlobUrl(id: string): string | undefined {
  return blobUrlCache.get(id)
}

/**
 * Save a file attachment to the overseer attachments directory.
 *
 * Reads the file as binary data and sends it to the Rust backend which
 * stores it at ~/.config/overseer[-dev]/attachments/{uuid}-{filename}.
 * Also caches a blob URL for in-session display.
 */
export async function saveAttachment(file: File): Promise<Attachment> {
  const buffer = await file.arrayBuffer()
  const data = Array.from(new Uint8Array(buffer))

  const result = await backend.invoke<{
    id: string
    filename: string
    path: string
    mimeType: string
    size: number
  }>("save_attachment", {
    filename: file.name,
    data,
  })

  const attachment: Attachment = {
    id: result.id,
    filename: result.filename,
    mimeType: result.mimeType,
    size: result.size,
    path: result.path,
  }

  // Cache a blob URL for in-session image display (avoids re-reading file)
  if (file.type.startsWith("image/")) {
    const blobUrl = URL.createObjectURL(file)
    blobUrlCache.set(result.id, blobUrl)
  }

  return attachment
}

/**
 * Save an attachment from an existing filesystem path (e.g. from a Tauri drag-drop event).
 */
export async function saveAttachmentFromPath(sourcePath: string): Promise<Attachment> {
  const result = await backend.invoke<{
    id: string
    filename: string
    path: string
    mimeType: string
    size: number
  }>("save_attachment_from_path", {
    sourcePath,
  })

  return {
    id: result.id,
    filename: result.filename,
    mimeType: result.mimeType,
    size: result.size,
    path: result.path,
  }
}
