import { describe, it, expect } from "vitest"
import { exportChatToMarkdown, generateFilename } from "../exportChat"
import type { Chat, Message } from "../../types"

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "Hello world",
    timestamp: new Date("2024-01-15T10:30:00Z"),
    ...overrides,
  }
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "test-chat-id",
    workspaceId: "test-workspace",
    label: "Test Chat",
    messages: [],
    status: "idle",
    agentType: "claude",
    agentSessionId: null,
    modelVersion: "opus",
    permissionMode: null,
    createdAt: new Date("2024-01-15T09:00:00Z"),
    updatedAt: new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  }
}

describe("exportChatToMarkdown", () => {
  it("includes chat metadata header", () => {
    const chat = makeChat()
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("# Test Chat")
    expect(md).toContain("**Agent**: Claude")
    expect(md).toContain("**Model**: opus")
    expect(md).toContain("**Created**:")
    expect(md).toContain("**Updated**:")
  })

  it("formats user messages", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "user",
          content: "What is the meaning of life?",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("## User")
    expect(md).toContain("What is the meaning of life?")
  })

  it("formats assistant text messages", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: "The answer is 42.",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("## Assistant")
    expect(md).toContain("The answer is 42.")
  })

  it("formats bash tool calls", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Bash]\n{"command": "npm install", "description": "Install dependencies"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Tool: Bash")
    expect(md).toContain("> Install dependencies")
    expect(md).toContain("```bash")
    expect(md).toContain("npm install")
  })

  it("formats read tool calls", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Read]\n{"file_path": "/path/to/file.ts"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Tool: Read")
    expect(md).toContain("Reading: `/path/to/file.ts`")
  })

  it("formats write tool calls", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Write]\n{"file_path": "/path/to/output.ts"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Tool: Write")
    expect(md).toContain("Writing: `/path/to/output.ts`")
  })

  it("formats bash output messages", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: "npm WARN deprecated package@1.0.0",
          isBashOutput: true,
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("```")
    expect(md).toContain("npm WARN deprecated package@1.0.0")
  })

  it("formats info messages in italics", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: "Rate limit reached, waiting...",
          isInfo: true,
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("_Rate limit reached, waiting..._")
  })

  it("handles cancelled messages", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: "[cancelled]",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("_User cancelled_")
  })

  it("skips system meta messages", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "user",
          content: "Some system content",
          meta: { type: "system", label: "System" },
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    // Should not contain the system message content directly after the header
    expect(md).not.toContain("Some system content")
  })

  it("formats user meta messages with label", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "user",
          content: "Please review my plan",
          meta: { type: "plan_review", label: "Plan Review" },
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Plan Review")
    expect(md).toContain("Please review my plan")
  })

  it("handles empty chat", () => {
    const chat = makeChat({ messages: [] })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("# Test Chat")
    expect(md).toContain("**Agent**: Claude")
  })

  it("formats web search tool calls", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[WebSearch]\n{"query": "Tauri v2 dialog plugin"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Tool: WebSearch")
    expect(md).toContain('Query: "Tauri v2 dialog plugin"')
  })

  it("formats unknown tools as JSON", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[CustomTool]\n{"foo": "bar", "count": 42}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("### Tool: CustomTool")
    expect(md).toContain("```json")
    expect(md).toContain('"foo": "bar"')
  })
})

describe("generateFilename", () => {
  it("converts label to lowercase filename", () => {
    const chat = makeChat({ label: "My Cool Chat" })
    expect(generateFilename(chat)).toBe("my-cool-chat.md")
  })

  it("replaces spaces with dashes", () => {
    const chat = makeChat({ label: "Hello World Test" })
    expect(generateFilename(chat)).toBe("hello-world-test.md")
  })

  it("removes invalid filename characters", () => {
    const chat = makeChat({ label: "Chat: Test/Path?" })
    expect(generateFilename(chat)).toBe("chat-test-path.md")
  })

  it("collapses multiple dashes", () => {
    const chat = makeChat({ label: "Test  --  Chat" })
    expect(generateFilename(chat)).toBe("test-chat.md")
  })

  it("trims leading and trailing dashes", () => {
    const chat = makeChat({ label: "  Test Chat  " })
    expect(generateFilename(chat)).toBe("test-chat.md")
  })

  it("truncates long labels", () => {
    const chat = makeChat({
      label: "This is a very long chat label that exceeds fifty characters easily",
    })
    const filename = generateFilename(chat)
    expect(filename.length).toBeLessThanOrEqual(53) // 50 chars + ".md"
    expect(filename).toMatch(/\.md$/)
  })

  it("returns fallback for empty label", () => {
    const chat = makeChat({ label: "   " })
    expect(generateFilename(chat)).toBe("chat.md")
  })

  it("handles special characters", () => {
    const chat = makeChat({ label: 'Fix <bug> in "utils" | 2024' })
    expect(generateFilename(chat)).toBe("fix-bug-in-utils-2024.md")
  })
})
