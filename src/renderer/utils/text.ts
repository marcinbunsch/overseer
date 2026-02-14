/**
 * Count the number of lines in a string
 */
export function countLines(s: string): number {
  if (!s) return 0
  return s.split("\n").length
}
