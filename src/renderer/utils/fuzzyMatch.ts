export interface FuzzyMatchResult {
  match: boolean
  score: number
}

/**
 * Performs fuzzy matching of a pattern against text.
 * Returns whether all characters of the pattern appear in the text in order,
 * along with a score based on match quality.
 *
 * Scoring factors:
 * - +10 for matches at word boundaries (after / or .)
 * - +5 cumulative bonus for consecutive character matches
 * - +1 for each matched character
 * - +20 bonus if pattern is found in the filename (last path segment)
 * - -1 penalty per path depth level (prefers shallower paths)
 */
export function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult {
  const lowerPattern = pattern.toLowerCase()
  const lowerText = text.toLowerCase()

  // Check if all characters of pattern appear in text in order
  let patternIdx = 0
  let score = 0
  let consecutiveBonus = 0
  let prevMatchIdx = -2

  for (let i = 0; i < lowerText.length && patternIdx < lowerPattern.length; i++) {
    if (lowerText[i] === lowerPattern[patternIdx]) {
      // Bonus for matches at word boundaries (after / or .)
      if (i === 0 || lowerText[i - 1] === "/" || lowerText[i - 1] === ".") {
        score += 10
      }
      // Bonus for consecutive matches
      if (i === prevMatchIdx + 1) {
        consecutiveBonus += 5
        score += consecutiveBonus
      } else {
        consecutiveBonus = 0
      }
      score += 1
      prevMatchIdx = i
      patternIdx++
    }
  }

  if (patternIdx === lowerPattern.length) {
    // Penalty for deeper paths (prefer less deeply nested files)
    const depthPenalty = (text.match(/\//g) || []).length
    score -= depthPenalty

    // Bonus for filename match (pattern found in last segment)
    const filename = text.split("/").pop() || ""
    if (filename.toLowerCase().includes(lowerPattern)) {
      score += 20
    }

    return { match: true, score }
  }

  return { match: false, score: 0 }
}
