/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mockInvoke: Mock = vi.fn(() => Promise.resolve(undefined))
const mockListen = vi.fn(() => Promise.resolve(() => {}))
const mockReload = vi.fn(() => Promise.resolve())
const mockSelectProject = vi.fn()
const mockSelectWorkspace = vi.fn()
vi.mock("../../../backend", () => ({
  backend: {
    invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args),
    listen: () => mockListen(),
  },
}))
vi.mock("../../../stores/ProjectRegistry", () => ({
  projectRegistry: {
    projects: [{ id: "repo-1", name: "myrepo", workspaces: [{ id: "ws-1", path: "/tmp/ws" }] }],
    reload: () => mockReload(),
    selectProject: (id: string) => mockSelectProject(id),
    selectWorkspace: (id: string) => mockSelectWorkspace(id),
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
    workspaceId: "ws-1",
    workspacePath: "/tmp/ws",
    branch: "overdrive/add-foo-abcd1234",
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
    mockReload.mockClear()
    mockSelectProject.mockClear()
    mockSelectWorkspace.mockClear()
    overdriveRunStore.runs = []
  })

  it("renders nothing when there are no actionable runs", () => {
    overdriveRunStore.runs = [makeRun({ status: "working" })]
    const { container } = render(<OverdriveInbox />)
    expect(container.querySelector('[data-testid="overdrive-inbox"]')).toBeNull()
  })

  it("shows a badge and a row for an actionable run", () => {
    overdriveRunStore.runs = [makeRun()]
    render(<OverdriveInbox />)
    expect(screen.getByTestId("overdrive-inbox-badge").textContent).toBe("1")
    expect(screen.getByTestId("overdrive-run-row")).toHaveTextContent("overdrive/add-foo-abcd1234")
  })

  it("navigates to the run's workspace on click", async () => {
    overdriveRunStore.runs = [makeRun()]
    render(<OverdriveInbox />)
    fireEvent.click(screen.getByTestId("overdrive-run-row"))

    await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledWith("ws-1"))
    expect(mockReload).toHaveBeenCalled()
    expect(mockSelectProject).toHaveBeenCalledWith("repo-1")
  })
})
