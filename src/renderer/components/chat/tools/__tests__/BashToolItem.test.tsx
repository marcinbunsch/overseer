/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BashToolItem } from "../BashToolItem"
import type { ToolCall } from "../parseToolCall"

function makeTool(command: string): ToolCall {
  return {
    label: "[Bash]",
    toolName: "Bash",
    body: JSON.stringify({ command }),
    input: { command },
  }
}

describe("BashToolItem", () => {
  it("truncates the command by default", () => {
    render(<BashToolItem tool={makeTool("git log --oneline --decorate --graph -12")} />)

    expect(screen.getByTestId("bash-command").className).toContain("truncate")
  })

  it("expands the command when clicked", () => {
    render(<BashToolItem tool={makeTool("git log --oneline --decorate --graph -12")} />)

    fireEvent.click(screen.getByTestId("bash-tool-item"))

    const command = screen.getByTestId("bash-command")
    expect(command.className).not.toContain("truncate")
    expect(command.className).toContain("whitespace-pre-wrap")
  })

  it("collapses again on a second click", () => {
    render(<BashToolItem tool={makeTool("ls -la")} />)

    const item = screen.getByTestId("bash-tool-item")
    fireEvent.click(item)
    fireEvent.click(item)

    expect(screen.getByTestId("bash-command").className).toContain("truncate")
  })
})
