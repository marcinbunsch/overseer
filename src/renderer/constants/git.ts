/**
 * Git status styles for short labels (used in file lists)
 */
export const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  M: { label: "M", color: "text-ovr-text-primary" },
  A: { label: "A", color: "text-ovr-diff-add" },
  D: { label: "D", color: "text-ovr-diff-del" },
  R: { label: "R", color: "text-ovr-azure-400" },
  "?": { label: "?", color: "text-ovr-text-dim" },
}

/**
 * Git status labels with full names (used in badges/headers)
 */
export const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  M: { label: "Modified", color: "text-ovr-text-primary" },
  A: { label: "Added", color: "text-ovr-diff-add" },
  D: { label: "Deleted", color: "text-ovr-diff-del" },
  R: { label: "Renamed", color: "text-ovr-azure-400" },
  "?": { label: "Untracked", color: "text-ovr-text-dim" },
}
