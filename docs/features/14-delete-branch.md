# Delete Branch Option

The delete branch feature provides an optional checkbox in merge and archive dialogs to remove the git branch along with the workspace.

## Overview

When archiving a workspace or merging a branch, users can optionally delete the associated git branch. This is useful for cleaning up feature branches after they've been merged or abandoned.

## User Flow

### Archive Dialog

1. Click the delete icon on a workspace in the left pane
2. Archive confirmation dialog appears
3. Check "Also remove branch" if desired
4. Click "Delete" to confirm

### Merge Dialog

1. Click "Merge" button in the Changes pane
2. Merge dialog appears with options
3. Check "Also remove branch" if desired
4. Choose "Just merge" or "Merge & archive"

## Behavior

**Merge flow:**

1. Merge branch into main via git
2. If "Merge & archive" selected, archive the workspace
3. If "Also remove branch" checked, delete the branch
4. Switch focus to main workspace

**Archive flow:**

1. Mark workspace as archiving (optimistic UI)
2. Switch focus to main workspace immediately
3. Remove workspace from git
4. Archive chat folder
5. If "Also remove branch" checked, delete the branch

**Error handling:**

- Branch deletion is non-blocking
- If deletion fails, the merge/archive still succeeds
- Toast message reflects what completed

## Toast Messages

| Scenario                 | Message                                                 |
| ------------------------ | ------------------------------------------------------- |
| Merge only               | "Branch merged successfully"                            |
| Merge + archive          | "Branch merged and workspace archived"                  |
| Merge + archive + delete | "Branch merged, workspace archived, and branch deleted" |
| Archive only             | "Workspace deleted"                                     |
| Archive + delete         | "Workspace and branch deleted"                          |

## Implementation

### Components

| File                   | Purpose                       |
| ---------------------- | ----------------------------- |
| `MergeDialog.tsx`      | Merge UI with checkbox        |
| `WorkspaceList.tsx`    | Archive dialog with checkbox  |
| `ChangedFilesStore.ts` | Merge logic                   |
| `RepoRegistry.ts`      | Archive logic                 |
| `git.ts`               | `deleteBranch()` service call |

### Key Functions

**ChangedFilesStore.merge(archiveAfter, deleteBranch)**

- Captures branch name before operations
- Merges into main
- Optionally archives workspace
- Optionally deletes branch

**RepoRegistry.archiveWorkspace(workspaceId, deleteBranch)**

- Performs optimistic UI update
- Archives workspace and chat folder
- Optionally deletes branch

**gitService.deleteBranch(repoPath, branchName)**

- Invokes Rust `delete_branch` command
- Called after workspace is removed

## Design Decisions

**Checkbox default:** Unchecked by default to prevent accidental branch deletion.

**Non-blocking deletion:** Branch deletion failures don't fail the overall operation. This handles edge cases like protected branches or network issues.

**Captured state:** Branch name and repo path are captured before async operations because workspace data may be deleted during execution.

**Optimistic updates:** Archive immediately switches focus to main for responsive feedback.
