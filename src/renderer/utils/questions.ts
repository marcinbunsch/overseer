import type { AgentQuestion } from "../types"

/**
 * Check if all questions have been answered
 */
export function areAllQuestionsAnswered(
  questions: AgentQuestion["questions"],
  selections: Record<string, string>,
  otherActive: Record<string, boolean>,
  otherTexts: Record<string, string>
): boolean {
  return questions.every((q) => {
    const key = q.header
    if (otherActive[key]) return (otherTexts[key] ?? "").trim().length > 0
    return (selections[key] ?? "").length > 0
  })
}

/**
 * Collect answers from form state into a single record.
 *
 * The output is keyed by the question TEXT, not the header: Claude Code's
 * AskUserQuestion tool looks up `answers[question.question]` (verified against
 * claude 2.1.197). The panel's internal form state is still keyed by header, so
 * we read by header and emit by question text. Pi ignores the key (it takes the
 * single value), so this keying is safe for both agents.
 */
export function collectAnswers(
  questions: AgentQuestion["questions"],
  selections: Record<string, string>,
  otherActive: Record<string, boolean>,
  otherTexts: Record<string, string>
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const key = q.header
    answers[q.question] = otherActive[key]
      ? (otherTexts[key] ?? "").trim()
      : (selections[key] ?? "")
  }
  return answers
}
