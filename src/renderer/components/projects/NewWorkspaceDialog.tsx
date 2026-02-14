import { useState, useRef, useEffect } from "react"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X } from "lucide-react"
import { faker } from "@faker-js/faker"

interface NewWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (branch: string) => void
}

function generateRandomName(): string {
  const animal = faker.animal.type()
  const adjective = faker.word.adjective()
  const noun = faker.word.noun()
  return `${animal}-${adjective}-${noun}`
}

export function NewWorkspaceDialog({ open, onOpenChange, onCreate }: NewWorkspaceDialogProps) {
  const [branchName, setBranchName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Generate random name and select it when dialog opens
  useEffect(() => {
    if (open) {
      const randomName = generateRandomName()
      setBranchName(randomName)
      // Select the input content after it's rendered
      requestAnimationFrame(() => {
        inputRef.current?.select()
      })
    }
  }, [open])

  const handleCreate = () => {
    if (!branchName.trim()) return
    onCreate(branchName.trim())
    onOpenChange(false)
    setBranchName("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-100 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <div className="flex items-center justify-between">
            <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
              New Workspace
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                <X className="size-4" />
              </button>
            </AlertDialog.Cancel>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-ovr-text-muted">
              Branch name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="feature/my-branch"
              autoFocus
              className="ovr-input w-full text-xs"
            />
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <button className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs">Cancel</button>
            </AlertDialog.Cancel>
            <button
              className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs"
              onClick={handleCreate}
              disabled={!branchName.trim()}
            >
              Create
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
