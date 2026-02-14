/**
 * Diff rendering utilities.
 *
 * Note: The actual diff rendering is now handled by @pierre/diffs.
 * This file contains utility functions for:
 * - Language detection from file paths
 * - Comment formatting
 *
 * The old HighlightedDiffTable, DiffRow, and CommentRow components
 * have been replaced by PierreDiffView and DiffCommentBox.
 */

export interface DiffLine {
  type: "add" | "del" | "context" | "hunk"
  content: string
  oldNum: number | null
  newNum: number | null
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  graphql: "graphql",
  xml: "xml",
  svg: "xml",
  dockerfile: "docker",
}

/**
 * Get the language identifier for syntax highlighting from a file path.
 */
export function getLanguage(filePath: string): string | undefined {
  const name = filePath.split("/").pop()?.toLowerCase() ?? ""
  if (name === "dockerfile") return "docker"
  const ext = name.split(".").pop() ?? ""
  return EXT_TO_LANGUAGE[ext]
}

/**
 * Format a diff comment for sending to the chat.
 * @deprecated - The new PierreDiffView handles comment formatting differently
 */
export function formatDiffComment(
  filePath: string,
  selectedLines: DiffLine[],
  comment: string
): string {
  const nums = selectedLines
    .map((line) => (line.type === "del" ? line.oldNum : line.newNum))
    .filter((n): n is number => n !== null)
  const startLine = Math.min(...nums)
  const endLine = Math.max(...nums)
  const lineRef = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`
  const snippet = selectedLines
    .map((l) => {
      const prefix = l.type === "add" ? "+" : l.type === "del" ? "-" : " "
      return `${prefix}${l.content}`
    })
    .join("\n")
  return `Comment on ${filePath} (${lineRef}):\n\`\`\`\n${snippet}\n\`\`\`\n\n${comment}`
}
