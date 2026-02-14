import { describe, it, expect } from "vitest"
import { parseToolCall } from "../parseToolCall"

describe("parseToolCall", () => {
  it("returns null for non-tool-call content", () => {
    expect(parseToolCall("just some text")).toBeNull()
    expect(parseToolCall("")).toBeNull()
    expect(parseToolCall("hello [world]")).toBeNull()
  })

  it("parses simple tool call like [Bash]", () => {
    const result = parseToolCall('[Bash]\n{"command": "ls -la"}')

    expect(result).not.toBeNull()
    expect(result!.label).toBe("[Bash]")
    expect(result!.toolName).toBe("Bash")
    expect(result!.input).toEqual({ command: "ls -la" })
  })

  it("parses [Read] tool call", () => {
    const result = parseToolCall('[Read]\n{"path": "/tmp/file.txt"}')

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe("Read")
    expect(result!.input).toEqual({ path: "/tmp/file.txt" })
  })

  it("parses [Auto-approved] prefix", () => {
    const result = parseToolCall('[Auto-approved] Bash\n{"command": "git status"}')

    expect(result).not.toBeNull()
    expect(result!.label).toBe("[Auto-approved]")
    expect(result!.toolName).toBe("Bash")
    expect(result!.input).toEqual({ command: "git status" })
  })

  it("parses [Tool approval required] prefix", () => {
    const result = parseToolCall('[Tool approval required] Write\n{"path": "/tmp/out.txt"}')

    expect(result).not.toBeNull()
    expect(result!.label).toBe("[Tool approval required]")
    expect(result!.toolName).toBe("Write")
    expect(result!.input).toEqual({ path: "/tmp/out.txt" })
  })

  it("handles tool call with no JSON body", () => {
    const result = parseToolCall("[Bash]")

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe("Bash")
    expect(result!.body).toBe("")
    expect(result!.input).toBeNull()
  })

  it("handles invalid JSON body gracefully", () => {
    const result = parseToolCall("[Bash]\nnot valid json {{{")

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe("Bash")
    expect(result!.input).toBeNull()
  })

  it("returns null for content without closing bracket", () => {
    expect(parseToolCall("[incomplete")).toBeNull()
  })

  it("parses nested JSON input correctly", () => {
    const content = '[Edit]\n{"file_path": "/tmp/a.ts", "old_string": "foo", "new_string": "bar"}'
    const result = parseToolCall(content)

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe("Edit")
    expect(result!.input).toEqual({
      file_path: "/tmp/a.ts",
      old_string: "foo",
      new_string: "bar",
    })
  })

  it("preserves the raw body string", () => {
    const json = '{"command": "echo hello"}'
    const result = parseToolCall(`[Bash]\n${json}`)

    expect(result).not.toBeNull()
    expect(result!.body).toBe(json)
  })

  it("handles [cancelled] as non-tool content", () => {
    // [cancelled] starts with [ but is not a tool call in the grouping logic
    // parseToolCall should still parse it structurally though
    const result = parseToolCall("[cancelled]")

    expect(result).not.toBeNull()
    expect(result!.toolName).toBe("cancelled")
    expect(result!.body).toBe("")
  })
})
