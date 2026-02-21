import { describe, it, expect } from "vitest"
import { parseOverseerBlocks, hasOverseerBlocks, extractOverseerBlocks } from "../overseerActions"

describe("overseerActions", () => {
  describe("parseOverseerBlocks", () => {
    it("parses a valid open_pr action", () => {
      const content = `Here's my response.

\`\`\`overseer
{"action": "open_pr", "params": {"title": "Add new feature", "body": "This PR adds..."}}
\`\`\`

More text here.`

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].action).toEqual({
        action: "open_pr",
        params: { title: "Add new feature", body: "This PR adds..." },
      })
      expect(blocks[0].rawBlock).toContain("```overseer")
    })

    it("parses a valid merge_branch action", () => {
      const content = `\`\`\`overseer
{"action": "merge_branch", "params": {"into": "main"}}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].action).toEqual({
        action: "merge_branch",
        params: { into: "main" },
      })
    })

    it("parses a valid rename_chat action", () => {
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Implementing dark mode"}}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].action).toEqual({
        action: "rename_chat",
        params: { title: "Implementing dark mode" },
      })
    })

    it("parses action without newline before closing backticks (Codex format)", () => {
      // Codex sometimes outputs the block without a newline before the closing backticks
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Codex style"}}\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].action).toEqual({
        action: "rename_chat",
        params: { title: "Codex style" },
      })
    })

    it("parses multiple overseer blocks", () => {
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "My Task"}}
\`\`\`

Some explanation here.

\`\`\`overseer
{"action": "open_pr", "params": {"title": "Complete task"}}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(2)
      expect(blocks[0].action.action).toBe("rename_chat")
      expect(blocks[1].action.action).toBe("open_pr")
    })

    it("ignores invalid JSON", () => {
      const content = `\`\`\`overseer
{invalid json}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(0)
    })

    it("ignores unknown actions", () => {
      const content = `\`\`\`overseer
{"action": "unknown_action", "params": {}}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(0)
    })

    it("ignores actions with missing required params", () => {
      const content = `\`\`\`overseer
{"action": "open_pr", "params": {}}
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(0)
    })

    it("returns empty array for content without overseer blocks", () => {
      const content = `Just regular text here.

\`\`\`javascript
const x = 1
\`\`\``

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(0)
    })

    it("captures block indices correctly", () => {
      const prefix = "Text before. "
      const block = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Test"}}
\`\`\``
      const content = prefix + block + " Text after."

      const blocks = parseOverseerBlocks(content)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].startIndex).toBe(prefix.length)
      expect(blocks[0].endIndex).toBe(prefix.length + block.length)
    })
  })

  describe("hasOverseerBlocks", () => {
    it("returns true when content has overseer blocks", () => {
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Test"}}
\`\`\``
      expect(hasOverseerBlocks(content)).toBe(true)
    })

    it("returns false when content has no overseer blocks", () => {
      const content = `Just regular markdown.

\`\`\`javascript
console.log("hello")
\`\`\``
      expect(hasOverseerBlocks(content)).toBe(false)
    })
  })

  describe("extractOverseerBlocks", () => {
    it("removes overseer blocks and returns actions", () => {
      const content = `Before text.

\`\`\`overseer
{"action": "rename_chat", "params": {"title": "My Task"}}
\`\`\`

After text.`

      const { cleanContent, actions } = extractOverseerBlocks(content)

      expect(actions).toHaveLength(1)
      expect(actions[0].action).toBe("rename_chat")
      expect(cleanContent).toBe("Before text.\n\nAfter text.")
    })

    it("handles multiple blocks", () => {
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Task"}}
\`\`\`

Middle text.

\`\`\`overseer
{"action": "open_pr", "params": {"title": "Done"}}
\`\`\``

      const { cleanContent, actions } = extractOverseerBlocks(content)

      expect(actions).toHaveLength(2)
      expect(cleanContent).toBe("Middle text.")
    })

    it("returns original content when no blocks", () => {
      const content = "Just regular text."
      const { cleanContent, actions } = extractOverseerBlocks(content)

      expect(actions).toHaveLength(0)
      expect(cleanContent).toBe(content)
    })

    it("handles content that is only an overseer block", () => {
      const content = `\`\`\`overseer
{"action": "rename_chat", "params": {"title": "Task"}}
\`\`\``

      const { cleanContent, actions } = extractOverseerBlocks(content)

      expect(actions).toHaveLength(1)
      expect(cleanContent).toBe("")
    })
  })
})
