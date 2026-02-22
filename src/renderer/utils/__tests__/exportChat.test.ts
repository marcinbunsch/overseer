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
  it("includes minimal chat header", () => {
    const chat = makeChat()
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("# Test Chat")
    expect(md).toContain("_Claude (opus)_")
    expect(md).toContain("---")
  })

  it("formats user messages as blockquotes", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "user",
          content: "What is the meaning of life?",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("> What is the meaning of life?")
  })

  it("formats multiline user messages with each line quoted", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "user",
          content: "Line one\nLine two\nLine three",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("> Line one\n> Line two\n> Line three")
  })

  it("formats assistant text messages as plain text", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: "The answer is 42.",
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("The answer is 42.")
    // Should NOT be blockquoted
    expect(md).not.toContain("> The answer is 42.")
  })

  it("formats bash tool calls as code blocks", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Bash]\n{"command": "npm install", "description": "Install dependencies"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("```bash")
    expect(md).toContain("npm install")
  })

  it("formats read tool calls with emoji", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Read]\n{"file_path": "/path/to/file.ts"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("📖 `/path/to/file.ts`")
  })

  it("formats write tool calls with emoji", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Write]\n{"file_path": "/path/to/output.ts"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("📝 `/path/to/output.ts`")
  })

  it("formats edit tool calls with emoji", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[Edit]\n{"file_path": "/path/to/file.ts"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("✏️ `/path/to/file.ts`")
  })

  it("formats bash output messages as code blocks", () => {
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

    expect(md).toContain("_Cancelled_")
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

    expect(md).not.toContain("Some system content")
  })

  it("formats user meta messages with label in blockquote", () => {
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

    expect(md).toContain("> **Plan Review**")
    expect(md).toContain("> Please review my plan")
  })

  it("handles empty chat", () => {
    const chat = makeChat({ messages: [] })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("# Test Chat")
    expect(md).toContain("_Claude (opus)_")
  })

  it("formats web search tool calls with emoji", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[WebSearch]\n{"query": "Tauri v2 dialog plugin"}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain('🔍 "Tauri v2 dialog plugin"')
  })

  it("formats unknown tools with bold name", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[CustomTool]\n{"foo": "bar", "count": 42}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("**CustomTool**")
  })

  it("skips TodoWrite tool calls", () => {
    const chat = makeChat({
      messages: [
        makeMessage({
          role: "assistant",
          content: '[TodoWrite]\n{"todos": []}',
        }),
      ],
    })
    const md = exportChatToMarkdown(chat)

    expect(md).not.toContain("TodoWrite")
  })

  it("handles chat without model version", () => {
    const chat = makeChat({ modelVersion: null })
    const md = exportChatToMarkdown(chat)

    expect(md).toContain("_Claude_")
    expect(md).not.toContain("(null)")
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
