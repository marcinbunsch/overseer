/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockInvoke: Mock = vi.fn(() => Promise.resolve(undefined))
const mockListen = vi.fn(() => Promise.resolve(() => {}))
vi.mock("../../../backend", () => ({
  backend: {
    invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args),
    listen: () => mockListen(),
  },
}))

import { OverdriveInbox } from "../OverdriveInbox"
import { overdriveRunStore } from "../../../stores/OverdriveRunStore"
import type { OverdriveRun } from "../../../types"

function makeRun(overrides: Partial<OverdriveRun> = {}): OverdriveRun {
  return {
    id: "run-1",
    taskId: "task-1",
    repoId: "repo-1",
    branch: "overdrive/add-foo-abcd1234",
    workspacePath: "/tmp/ws",
    status: "needsReview",
    verifyBounces: 0,
    iterationsUsed: 2,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("OverdriveInbox", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    overdriveRunStore.runs = []
  })

  it("renders nothing when there are no actionable runs", () => {
    overdriveRunStore.runs = [makeRun({ status: "working" })]
    const { container } = render(<OverdriveInbox />)
    expect(container.querySelector('[data-testid="overdrive-inbox"]')).toBeNull()
  })

  it("shows a badge and a row for an actionable run", async () => {
    overdriveRunStore.runs = [makeRun()]
    mockInvoke.mockResolvedValue([makeRun()]) // start()'s reload keeps it
    render(<OverdriveInbox />)
    expect(screen.getByTestId("overdrive-inbox-badge").textContent).toBe("1")
    expect(screen.getByTestId("overdrive-run-row")).toHaveTextContent("overdrive/add-foo-abcd1234")
  })

  it("opens the review dialog and approves", async () => {
    overdriveRunStore.runs = [makeRun()]
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "overdrive_list_runs") return Promise.resolve([makeRun()])
      if (cmd === "list_changed_files") return Promise.resolve({ files: [], uncommitted: [] })
      if (cmd === "overdrive_approve_run")
        return Promise.resolve({ success: true, conflicts: [], message: "" })
      return Promise.resolve(undefined)
    })

    render(<OverdriveInbox />)
    fireEvent.click(screen.getByTestId("overdrive-run-row"))

    await waitFor(() => expect(screen.getByTestId("run-review-title")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("run-approve"))

    await waitFor(() =>
      expect(
        mockInvoke.mock.calls.some(
          ([cmd, args]) =>
            cmd === "overdrive_approve_run" && (args as { runId: string }).runId === "run-1"
        )
      ).toBe(true)
    )
  })
})
