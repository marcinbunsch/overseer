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
 * Collect answers from form state into a single record
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
    answers[key] = otherActive[key] ? (otherTexts[key] ?? "").trim() : (selections[key] ?? "")
  }
  return answers
}
