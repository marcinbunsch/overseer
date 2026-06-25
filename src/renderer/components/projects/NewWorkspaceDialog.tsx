import { useState, useRef, useEffect, useMemo } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, Loader2 } from "lucide-react"
import { faker } from "@faker-js/faker"
import { Input } from "../shared/Input"
import { gitService } from "../../services/git"
import type { ReviewPr } from "../../services/git"
import { configStore } from "../../stores/ConfigStore"

interface NewWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (branch: string) => void
  repoPath?: string
  existingBranches?: string[]
  mainBranch?: string
}

function generateRandomName(): string {
  const animal = faker.animal.type()
  const adjective = faker.word.adjective()
  const noun = faker.word.noun()
  return `${animal}-${adjective}-${noun}`
}

export const NewWorkspaceDialog = observer(function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
  repoPath,
  existingBranches = [],
  mainBranch,
}: NewWorkspaceDialogProps) {
  const [branchName, setBranchName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  // null = loading, string[] = fetched raw from git (may be empty)
  const [rawBranches, setRawBranches] = useState<string[] | null>(null)
  // null = loading, ReviewPr[] = fetched (may be empty)
  const [reviewPrs, setReviewPrs] = useState<ReviewPr[] | null>(null)

  // Generate a random name and select it when the dialog opens
  useEffect(() => {
    if (!open) return
    setBranchName(generateRandomName())
    requestAnimationFrame(() => {
      inputRef.current?.select()
    })
  }, [open])

  // Fetch recent remote branches when the dialog opens (or repoPath changes)
  useEffect(() => {
    if (!open || !repoPath) {
      setRawBranches(null)
      return
    }
    setRawBranches(null)
    let cancelled = false
    gitService
      .listRecentBranches(repoPath)
      .then((branches) => {
        if (!cancelled) setRawBranches(branches)
      })
      .catch(() => {
        if (!cancelled) setRawBranches([])
      })
    return () => {
      cancelled = true
    }
  }, [open, repoPath])

  // Fetch PRs waiting for review when the dialog opens (or repoPath changes)
  useEffect(() => {
    if (!open || !repoPath || !configStore.showReviewPrs) {
      setReviewPrs(null)
      return
    }
    setReviewPrs(null)
    let cancelled = false
    gitService
      .listReviewPrs(repoPath)
      .then((prs) => {
        if (!cancelled) setReviewPrs(prs)
      })
      .catch(() => {
        if (!cancelled) setReviewPrs([])
      })
    return () => {
      cancelled = true
    }
  }, [open, repoPath])

  // Filter during render so changes to existingBranches/mainBranch are always current
  // without needing to re-fetch
  const recentBranches = useMemo(() => {
    if (rawBranches === null) return null
    const existingSet = new Set(existingBranches)
    return rawBranches.filter((b) => !existingSet.has(b) && b !== mainBranch).slice(0, 10)
  }, [rawBranches, existingBranches, mainBranch])

  const handleCreate = () => {
    if (!branchName.trim()) return
    onCreate(branchName.trim())
    onOpenChange(false)
    setBranchName("")
  }

  const handleSelectBranch = (branch: string) => {
    onCreate(branch)
    onOpenChange(false)
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
            <Input
              ref={inputRef}
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="feature/my-branch"
              autoFocus
              className="w-full text-xs"
            />
          </div>

          {repoPath && (
            <div className="mt-4 flex flex-col gap-4">
              {recentBranches === null ? (
                <div
                  className="flex items-center gap-1.5 text-xs text-ovr-text-dim"
                  data-testid="recent-branches-loading"
                >
                  <Loader2 className="size-3 animate-spin" />
                  <span>Loading recent branches…</span>
                </div>
              ) : recentBranches.length > 0 ? (
                <div data-testid="recent-branches-list">
                  <p className="mb-1.5 text-xs font-medium text-ovr-text-muted">Recent branches</p>
                  <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
                    {recentBranches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleSelectBranch(branch)}
                        className="truncate rounded px-2 py-1 text-left text-xs text-ovr-text-primary transition-colors hover:bg-ovr-bg-elevated hover:text-ovr-text-strong"
                        data-testid="recent-branch-item"
                      >
                        {branch}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {configStore.showReviewPrs &&
                (reviewPrs === null ? (
                  <div
                    className="flex items-center gap-1.5 text-xs text-ovr-text-dim"
                    data-testid="review-prs-loading"
                  >
                    <Loader2 className="size-3 animate-spin" />
                    <span>Loading PRs waiting for review…</span>
                  </div>
                ) : reviewPrs.length > 0 ? (
                  <div data-testid="review-prs-list">
                    <p className="mb-1.5 text-xs font-medium text-ovr-text-muted">
                      PRs waiting for review
                    </p>
                    <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
                      {reviewPrs.map((pr) => (
                        <button
                          key={pr.number}
                          onClick={() => handleSelectBranch(pr.headRefName)}
                          className="rounded px-2 py-1 text-left transition-colors hover:bg-ovr-bg-elevated"
                          data-testid="review-pr-item"
                        >
                          <span className="block truncate text-xs text-ovr-text-primary hover:text-ovr-text-strong">
                            <span className="text-ovr-text-dim">#{pr.number}</span> {pr.title}
                          </span>
                          <span className="block truncate text-xs text-ovr-text-dim">
                            {pr.headRefName} · by {pr.authorLogin}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null)}
            </div>
          )}

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
})
