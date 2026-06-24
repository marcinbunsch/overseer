/**
 * Check if a branch name is the project's default branch.
 *
 * When `mainBranch` is provided (non-empty), it is authoritative — only that
 * exact name matches. Otherwise, fall back to the conventional `main`/`master`.
 */
export function isDefaultBranch(branch: string, mainBranch: string | undefined): boolean {
  if (mainBranch && mainBranch.length > 0) {
    return branch === mainBranch
  }
  return branch === "main" || branch === "master"
}
