/**
 * Button to save the current chat to a Markdown file.
 *
 * This is a Tauri-only feature because it relies on:
 * - @tauri-apps/plugin-dialog for native file picker
 * - @tauri-apps/plugin-fs for writing files
 *
 * These are Tauri-specific APIs not available in overseer-core's
 * framework-agnostic design.
 */

import { useCallback } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { Download } from "lucide-react"
import type { Chat } from "../../types"
import { exportChatToMarkdown, generateFilename } from "../../utils/exportChat"
import { toastStore } from "../../stores/ToastStore"

interface SaveChatButtonProps {
  chat: Chat
}

export function SaveChatButton({ chat }: SaveChatButtonProps) {
  const handleSave = useCallback(async () => {
    try {
      const defaultFilename = generateFilename(chat)

      const filePath = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: defaultFilename,
      })

      if (!filePath) {
        // User cancelled
        return
      }

      const markdown = exportChatToMarkdown(chat)
      await writeTextFile(filePath, markdown)

      toastStore.show("Chat saved to Markdown")
    } catch (error) {
      console.error("Failed to save chat:", error)
      toastStore.show("Failed to save chat")
    }
  }, [chat])

  return (
    <button
      onClick={handleSave}
      className="rounded border border-ovr-border-subtle p-1 text-ovr-text-muted transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-primary"
      title="Save chat to Markdown"
    >
      <Download size={16} />
    </button>
  )
}
