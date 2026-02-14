import { describe, it, expect } from "vitest"
import { areAllQuestionsAnswered, collectAnswers } from "../questions"
import type { AgentQuestion } from "../../types"

const sampleQuestions: AgentQuestion["questions"] = [
  {
    question: "What framework?",
    header: "framework",
    options: [
      { label: "React", description: "React framework" },
      { label: "Vue", description: "Vue framework" },
    ],
    multiSelect: false,
  },
  {
    question: "What features?",
    header: "features",
    options: [
      { label: "TypeScript", description: "Add TypeScript" },
      { label: "Testing", description: "Add testing" },
    ],
    multiSelect: true,
  },
]

describe("areAllQuestionsAnswered", () => {
  it("returns false when no questions are answered", () => {
    expect(areAllQuestionsAnswered(sampleQuestions, {}, {}, {})).toBe(false)
  })

  it("returns false when only some questions are answered", () => {
    expect(areAllQuestionsAnswered(sampleQuestions, { framework: "React" }, {}, {})).toBe(false)
  })

  it("returns true when all questions have selections", () => {
    expect(
      areAllQuestionsAnswered(
        sampleQuestions,
        { framework: "React", features: "TypeScript" },
        {},
        {}
      )
    ).toBe(true)
  })

  it("returns true when other option is active with text", () => {
    expect(
      areAllQuestionsAnswered(
        sampleQuestions,
        { features: "TypeScript" },
        { framework: true },
        { framework: "Angular" }
      )
    ).toBe(true)
  })

  it("returns false when other option is active but empty", () => {
    expect(
      areAllQuestionsAnswered(
        sampleQuestions,
        { features: "TypeScript" },
        { framework: true },
        { framework: "" }
      )
    ).toBe(false)
  })

  it("returns false when other option is active with only whitespace", () => {
    expect(
      areAllQuestionsAnswered(
        sampleQuestions,
        { features: "TypeScript" },
        { framework: true },
        { framework: "   " }
      )
    ).toBe(false)
  })
})

describe("collectAnswers", () => {
  it("collects answers from selections", () => {
    const result = collectAnswers(
      sampleQuestions,
      { framework: "React", features: "TypeScript, Testing" },
      {},
      {}
    )
    expect(result).toEqual({
      framework: "React",
      features: "TypeScript, Testing",
    })
  })

  it("uses other text when other is active", () => {
    const result = collectAnswers(
      sampleQuestions,
      { features: "TypeScript" },
      { framework: true },
      { framework: "  Angular  " }
    )
    expect(result).toEqual({
      framework: "Angular",
      features: "TypeScript",
    })
  })

  it("returns empty string for unanswered questions", () => {
    const result = collectAnswers(sampleQuestions, {}, {}, {})
    expect(result).toEqual({
      framework: "",
      features: "",
    })
  })

  it("prefers selection over other when other is not active", () => {
    const result = collectAnswers(
      sampleQuestions,
      { framework: "React", features: "Testing" },
      { framework: false },
      { framework: "Angular" }
    )
    expect(result).toEqual({
      framework: "React",
      features: "Testing",
    })
  })
})
