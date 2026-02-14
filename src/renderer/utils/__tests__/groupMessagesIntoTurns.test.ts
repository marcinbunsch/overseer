import { describe, it, expect } from "vitest"
import { groupMessagesIntoTurns } from "../groupMessagesIntoTurns"
import type { Message } from "../../types"

function msg(role: "user" | "assistant", content: string): Message {
  return {
    id: `msg-${Math.random()}`,
    role,
    content,
    timestamp: new Date(),
  }
}

describe("groupMessagesIntoTurns", () => {
  it("returns empty array for empty messages", () => {
    expect(groupMessagesIntoTurns([], false)).toEqual([])
  })

  it("creates a single turn from one user + one assistant message", () => {
    const messages = [msg("user", "hello"), msg("assistant", "hi there")]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage.content).toBe("hello")
    expect(turns[0].resultMessage?.content).toBe("hi there")
    expect(turns[0].workMessages).toHaveLength(0)
    expect(turns[0].inProgress).toBe(false)
  })

  it("separates tool call messages from the final result", () => {
    const messages = [
      msg("user", "do something"),
      msg("assistant", '[Bash]\n{"command": "ls"}'),
      msg("assistant", '[Read]\n{"path": "foo.txt"}'),
      msg("assistant", "Here are the results"),
    ]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].workMessages).toHaveLength(2)
    expect(turns[0].workMessages[0].content).toContain("[Bash]")
    expect(turns[0].workMessages[1].content).toContain("[Read]")
    expect(turns[0].resultMessage?.content).toBe("Here are the results")
  })

  it("handles multiple turns", () => {
    const messages = [
      msg("user", "first question"),
      msg("assistant", "first answer"),
      msg("user", "second question"),
      msg("assistant", "second answer"),
    ]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(2)
    expect(turns[0].userMessage.content).toBe("first question")
    expect(turns[0].resultMessage?.content).toBe("first answer")
    expect(turns[1].userMessage.content).toBe("second question")
    expect(turns[1].resultMessage?.content).toBe("second answer")
  })

  it("marks last turn as in-progress when isSending is true", () => {
    const messages = [msg("user", "hello"), msg("assistant", '[Bash]\n{"command": "ls"}')]

    const turns = groupMessagesIntoTurns(messages, true)

    expect(turns).toHaveLength(1)
    expect(turns[0].inProgress).toBe(true)
    // Should not finalize when in progress — tool call stays in workMessages
    expect(turns[0].resultMessage).toBeNull()
  })

  it("handles orphan assistant message with no preceding user message", () => {
    const messages = [msg("assistant", "unexpected message")]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    // Orphan assistant becomes the userMessage placeholder
    expect(turns[0].userMessage.content).toBe("unexpected message")
  })

  it("handles user message with no assistant response", () => {
    const messages = [msg("user", "hello?")]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage.content).toBe("hello?")
    expect(turns[0].resultMessage).toBeNull()
    expect(turns[0].workMessages).toHaveLength(0)
  })

  it("treats [cancelled] as a non-tool-call result message", () => {
    const messages = [
      msg("user", "do something"),
      msg("assistant", '[Bash]\n{"command": "ls"}'),
      msg("assistant", "[cancelled]"),
    ]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].resultMessage?.content).toBe("[cancelled]")
    expect(turns[0].workMessages).toHaveLength(1)
  })

  it("picks the last non-tool-call message as result", () => {
    const messages = [
      msg("user", "do something"),
      msg("assistant", "thinking..."),
      msg("assistant", '[Bash]\n{"command": "ls"}'),
      msg("assistant", "here is the result"),
    ]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].resultMessage?.content).toBe("here is the result")
    expect(turns[0].workMessages).toHaveLength(2)
    expect(turns[0].workMessages[0].content).toBe("thinking...")
    expect(turns[0].workMessages[1].content).toContain("[Bash]")
  })

  it("handles only tool call messages with no text result", () => {
    const messages = [
      msg("user", "do something"),
      msg("assistant", '[Bash]\n{"command": "ls"}'),
      msg("assistant", '[Read]\n{"path": "foo"}'),
    ]

    const turns = groupMessagesIntoTurns(messages, false)

    expect(turns).toHaveLength(1)
    expect(turns[0].resultMessage).toBeNull()
    expect(turns[0].workMessages).toHaveLength(2)
  })

  it("does not finalize in-progress turn even with text messages", () => {
    const messages = [msg("user", "hello"), msg("assistant", "working on it...")]

    const turns = groupMessagesIntoTurns(messages, true)

    expect(turns).toHaveLength(1)
    expect(turns[0].inProgress).toBe(true)
    expect(turns[0].resultMessage).toBeNull()
    expect(turns[0].workMessages).toHaveLength(1)
  })

  it("finalizes earlier turns even when last turn is in-progress", () => {
    const messages = [
      msg("user", "first"),
      msg("assistant", "first answer"),
      msg("user", "second"),
      msg("assistant", '[Bash]\n{"command": "ls"}'),
    ]

    const turns = groupMessagesIntoTurns(messages, true)

    expect(turns).toHaveLength(2)
    // First turn is finalized
    expect(turns[0].inProgress).toBe(false)
    expect(turns[0].resultMessage?.content).toBe("first answer")
    // Second turn is in progress
    expect(turns[1].inProgress).toBe(true)
    expect(turns[1].resultMessage).toBeNull()
  })
})
