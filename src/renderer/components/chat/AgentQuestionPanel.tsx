import { useState } from "react"
import { observer } from "mobx-react-lite"
import type { AgentQuestion } from "../../types"
import { areAllQuestionsAnswered, collectAnswers } from "../../utils/questions"

interface AgentQuestionPanelProps {
  pendingQuestions: AgentQuestion[]
  onAnswer: (toolUseId: string, answers: Record<string, string>) => void
}

export const AgentQuestionPanel = observer(function AgentQuestionPanel({
  pendingQuestions,
  onAnswer,
}: AgentQuestionPanelProps) {
  if (pendingQuestions.length === 0) return null

  return (
    <div className="border-t border-ovr-border-subtle bg-ovr-bg-panel px-4 py-3">
      {pendingQuestions.map((agentQ) => (
        <QuestionSet key={agentQ.id} agentQuestion={agentQ} onAnswer={onAnswer} />
      ))}
    </div>
  )
})

interface QuestionSetProps {
  agentQuestion: AgentQuestion
  onAnswer: (toolUseId: string, answers: Record<string, string>) => void
}

function QuestionSet({ agentQuestion, onAnswer }: QuestionSetProps) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({})

  const allAnswered = areAllQuestionsAnswered(
    agentQuestion.questions,
    selections,
    otherActive,
    otherTexts
  )

  function handleSubmit() {
    const answers = collectAnswers(agentQuestion.questions, selections, otherActive, otherTexts)
    onAnswer(agentQuestion.id, answers)
  }

  function toggleMulti(header: string, label: string) {
    setOtherActive((prev) => ({ ...prev, [header]: false }))
    setSelections((prev) => {
      const current = prev[header] ?? ""
      const selected = current ? current.split(", ") : []
      const idx = selected.indexOf(label)
      if (idx >= 0) {
        selected.splice(idx, 1)
      } else {
        selected.push(label)
      }
      return { ...prev, [header]: selected.join(", ") }
    })
  }

  function selectSingle(header: string, label: string) {
    setOtherActive((prev) => ({ ...prev, [header]: false }))
    setSelections((prev) => ({ ...prev, [header]: label }))
  }

  function activateOther(header: string) {
    setOtherActive((prev) => ({ ...prev, [header]: true }))
    setSelections((prev) => ({ ...prev, [header]: "" }))
  }

  return (
    <div className="mb-2 last:mb-0 rounded-lg border border-ovr-border-subtle bg-ovr-bg-app p-3">
      <div className="mb-3 text-xs font-medium text-ovr-text-muted">Claude is asking:</div>

      {agentQuestion.questions.map((q) => {
        const key = q.header
        const currentSelection = selections[key] ?? ""
        const selectedSet = q.multiSelect
          ? new Set(currentSelection ? currentSelection.split(", ") : [])
          : null

        return (
          <div key={key} className="mb-4 last:mb-2">
            <div className="mb-2 text-sm font-medium text-ovr-text-primary">{q.question}</div>

            <div className="flex flex-col gap-1">
              {q.options.map((opt) => {
                const isSelected = q.multiSelect
                  ? selectedSet!.has(opt.label)
                  : currentSelection === opt.label && !otherActive[key]

                return (
                  <button
                    key={opt.label}
                    onClick={() =>
                      q.multiSelect ? toggleMulti(key, opt.label) : selectSingle(key, opt.label)
                    }
                    className={`flex items-start gap-2 rounded px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "bg-ovr-azure-500/15 border border-ovr-azure-500/40"
                        : "border border-transparent hover:bg-ovr-bg-panel"
                    }`}
                  >
                    <span className="mt-0.5 shrink-0 text-xs text-ovr-text-muted">
                      {q.multiSelect ? (isSelected ? "☑" : "☐") : isSelected ? "●" : "○"}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-ovr-text-primary">{opt.label}</div>
                      {opt.description && (
                        <div className="text-xs text-ovr-text-muted">{opt.description}</div>
                      )}
                    </div>
                  </button>
                )
              })}

              {/* Other option */}
              <button
                onClick={() => activateOther(key)}
                className={`flex items-start gap-2 rounded px-3 py-2 text-left transition-colors ${
                  otherActive[key]
                    ? "bg-ovr-azure-500/15 border border-ovr-azure-500/40"
                    : "border border-transparent hover:bg-ovr-bg-panel"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-xs text-ovr-text-muted">
                  {q.multiSelect ? "☐" : otherActive[key] ? "●" : "○"}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ovr-text-primary">Other</div>
                  {otherActive[key] && (
                    <input
                      type="text"
                      autoFocus
                      value={otherTexts[key] ?? ""}
                      onChange={(e) =>
                        setOtherTexts((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && allAnswered) handleSubmit()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Type your answer..."
                      className="mt-1 w-full rounded border border-ovr-border-subtle bg-ovr-bg-panel px-2 py-1 text-xs text-ovr-text-primary outline-none focus:border-ovr-azure-500"
                    />
                  )}
                </div>
              </button>
            </div>
          </div>
        )
      })}

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Submit
        </button>
      </div>
    </div>
  )
}
