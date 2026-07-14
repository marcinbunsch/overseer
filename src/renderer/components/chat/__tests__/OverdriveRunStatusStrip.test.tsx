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
vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    projects: [{ id: "repo-1", name: "myrepo", workspaces: [] }],
    reload: () => Promise.resolve(),
    selectProject: vi.fn(),
    selectWorkspace: vi.fn(),
  },
}))

import { OverdriveRunStatusStrip } from "../OverdriveRunStatusStrip"
import { overdriveRunStore } from "../../../stores/OverdriveRunStore"
import type { OverdriveRun } from "../../../types"

function makeRun(overrides: Partial<OverdriveRun> = {}): OverdriveRun {
  return {
    id: "run-1",
    taskId: "task-1",
    repoId: "repo-1",
    workspacePath: "/tmp/ws",
    branch: "overdrive/x",
    status: "needsReview",
    verifyBounces: 0,
    iterationsUsed: 1,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("OverdriveRunStatusStrip", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    overdriveRunStore.runs = []
  })

  it("renders nothing for a workspace with no matching run", () => {
    overdriveRunStore.runs = []
    const { container } = render(<OverdriveRunStatusStrip workspacePath="/tmp/other" />)
    expect(container.querySelector('[data-testid="overdrive-run-strip"]')).toBeNull()
  })

  it("renders the strip when the workspace matches a run", () => {
    overdriveRunStore.runs = [makeRun()]
    render(<OverdriveRunStatusStrip workspacePath="/tmp/ws" />)
    expect(screen.getByTestId("overdrive-run-strip")).toBeInTheDocument()
    expect(screen.getByTestId("overdrive-strip-approve")).not.toBeDisabled()
  })

  it("approve calls the store", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "overdrive_approve_run")
        return Promise.resolve({ success: true, conflicts: [], message: "" })
      return Promise.resolve([])
    })
    overdriveRunStore.runs = [makeRun()]
    render(<OverdriveRunStatusStrip workspacePath="/tmp/ws" />)

    fireEvent.click(screen.getByTestId("overdrive-strip-approve"))
    await waitFor(() =>
      expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_approve_run")).toBe(true)
    )
  })

  it("approve is disabled unless the run needs review", () => {
    overdriveRunStore.runs = [makeRun({ status: "failed" })]
    render(<OverdriveRunStatusStrip workspacePath="/tmp/ws" />)
    expect(screen.getByTestId("overdrive-strip-approve")).toBeDisabled()
    expect(screen.getByTestId("overdrive-strip-reject")).not.toBeDisabled()
  })
})
