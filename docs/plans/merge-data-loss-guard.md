# Plan: Stop the merge path from silently deleting work

## Context

A user merged a workspace's branch with "Merge & archive". The merge silently did
nothing, yet Overseer still removed the workspace directory and deleted the branch —
losing the work. The lost session was `jaguar` on branch `ui-clutter-fix`; the agent
had made edits but never ran `git commit`, so the changes existed only as uncommitted
files in the worktree. (Those specific changes were recovered from the archived chat
transcript, which records every Edit tool call.)

Three defects chain together. Any one of them alone would have prevented the loss.

## Root Causes

### 1. A no-op merge reports success

`crates/overseer-core/src/git/merge.rs:288` — `merge_into_main` treats `git merge`
exit code 0 as `success: true`. But `git merge` also returns 0 for **"Already up to
date."** When the feature branch has no commits ahead of the default branch (empty
branch, or all work uncommitted), git no-ops, and Overseer reports
"Branch merged successfully."

### 2. Force-remove destroys uncommitted changes

`crates/overseer-core/src/git/worktree.rs:313` — `archive_workspace` runs
`git worktree remove`, and on failure falls back to `git worktree remove --force`,
which discards the working tree. A dirty worktree is blown away with no warning.

### 3. A failed removal still deletes the branch

`src/renderer/stores/ProjectRegistry.ts:463` — `archiveWorkspace` catches the git
removal error, logs "cleaning up anyway", then proceeds to delete the branch and mark
the workspace archived regardless.

## Design

Fix each defect so no single failure destroys a workspace:

- An empty / already-merged branch no longer reports a mergeable success.
- A dirty worktree is never force-removed behind the user's back — the flow prompts
  "Workspace has uncommitted changes — discard and archive?" before any force.
- A failed worktree removal never cascades into branch deletion.

## Files to Modify

### 1. `crates/overseer-core/src/git/merge.rs`

- Add `already_up_to_date: bool` to `MergeResult` (explicit flag, not overloading
  `success` — per SCRATCHPAD "explicit over implicit").
- In `merge_into_main`, before merging, check whether the feature branch has commits
  not on the default branch (`git rev-list --count <default>..<feature>`). If zero,
  return `{ success: false, already_up_to_date: true, message: "Nothing to merge —
  'X' has no commits that aren't already on 'main'." }` without running the merge.

### 2. `crates/overseer-core/src/git/worktree.rs`

- Add a `force: bool` parameter to `archive_workspace`.
- `force: false` runs `git worktree remove` only. If it fails because the worktree is
  dirty, return a distinct `GitError::WorktreeDirty` instead of forcing.
- `force: true` runs `--force` (deliberate discard).

### 3. `src-tauri/src/git.rs`

- Thread the `force` param through the `archive_workspace` Tauri command.

### 4. `src/renderer/services/git.ts` and `types.ts`

- Add `alreadyUpToDate` to the `MergeResult` type.
- Add `force?: boolean` to the `archiveWorkspace` service method.

### 5. `src/renderer/stores/ChangedFilesStore.ts`

- In `merge()`, handle the `alreadyUpToDate` result: informative toast, no archive,
  no branch delete.
- On a `WorktreeDirty` error from archive, prompt "Workspace has uncommitted changes —
  discard and archive?" before retrying with `force: true`.

### 6. `src/renderer/stores/ProjectRegistry.ts`

- In `archiveWorkspace`, stop the catch-and-continue at line 463. If worktree removal
  fails, revert the optimistic state, do **not** delete the branch, do **not** mark
  archived, and surface the error.

## Tests

- **Rust** (`merge.rs`): a no-op merge returns `already_up_to_date` and leaves the
  default branch untouched.
- **Rust** (`worktree.rs`): a dirty worktree with `force: false` returns
  `WorktreeDirty` and removes nothing; `force: true` removes it.
- **Frontend** (`ChangedFilesStore`): the `alreadyUpToDate` path calls neither
  `archiveWorkspace` nor `deleteBranch`; an archive failure does not delete the branch.
