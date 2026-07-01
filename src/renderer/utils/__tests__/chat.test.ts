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

  it("labels thinking messages separately", () => {
    const messages = [
      { ...makeMessage("Let me reason..."), isThinking: true },
      makeMessage("[Bash] ls"),
    ]
    expect(summarizeTurnWork(messages)).toBe("1 tool call, thinking")
  })

  it("does not count a thinking message as a text message", () => {
    const messages = [{ ...makeMessage("reasoning trace"), isThinking: true }]
    expect(summarizeTurnWork(messages)).toBe("thinking")
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
