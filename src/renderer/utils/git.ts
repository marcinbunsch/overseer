/**
 * Check if a branch name is a default branch (main or master)
 */
export function isDefaultBranch(branch: string): boolean {
  return branch === "main" || branch === "master"
}
