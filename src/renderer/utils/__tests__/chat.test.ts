import { describe, it, expect } from "vitest"
import { summarizeTurnWork } from "../chat"
import type { Message } from "../../types"

function makeMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    timestamp: new Date(),
  }
}

describe("summarizeTurnWork", () => {
  it("returns empty string for no messages", () => {
    expect(summarizeTurnWork([])).toBe("")
  })

  it("counts a single tool call", () => {
    const messages = [makeMessage("[Read] file.txt")]
    expect(summarizeTurnWork(messages)).toBe("1 tool call")
  })

  it("counts multiple tool calls", () => {
    const messages = [
      makeMessage("[Read] file1.txt"),
      makeMessage("[Write] file2.txt"),
      makeMessage("[Bash] npm install"),
    ]
    expect(summarizeTurnWork(messages)).toBe("3 tool calls")
  })

  it("counts a single text message", () => {
    const messages = [makeMessage("Thinking about the problem...")]
    expect(summarizeTurnWork(messages)).toBe("1 message")
  })

  it("counts multiple text messages", () => {
    const messages = [makeMessage("First thought"), makeMessage("Second thought")]
    expect(summarizeTurnWork(messages)).toBe("2 messages")
  })

  it("counts mixed tool calls and text messages", () => {
    const messages = [
      makeMessage("[Read] file.txt"),
      makeMessage("Analyzing the code..."),
      makeMessage("[Write] output.txt"),
    ]
    expect(summarizeTurnWork(messages)).toBe("2 tool calls, 1 message")
  })

  it("handles complex mixed content", () => {
    const messages = [
      makeMessage("[Read] a.txt"),
      makeMessage("[Read] b.txt"),
      makeMessage("Processing..."),
      makeMessage("More processing..."),
      makeMessage("[Write] result.txt"),
    ]
    expect(summarizeTurnWork(messages)).toBe("3 tool calls, 2 messages")
  })
})
