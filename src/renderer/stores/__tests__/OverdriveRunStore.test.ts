import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"

const mockInvoke: Mock = vi.fn(() => Promise.resolve(undefined))
const mockListen = vi.fn(() => Promise.resolve(() => {}))
vi.mock("../../backend", () => ({
  backend: {
    invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args),
    listen: () => mockListen(),
  },
}))

import { overdriveRunStore } from "../OverdriveRunStore"
import type { OverdriveRun } from "../../types"

function makeRun(overrides: Partial<OverdriveRun> = {}): OverdriveRun {
  return {
    id: crypto.randomUUID(),
    taskId: "task-1",
    repoId: "repo-1",
    status: "needsReview",
    verifyBounces: 0,
    iterationsUsed: 1,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("OverdriveRunStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    overdriveRunStore.runs = []
  })

  it("loadRuns populates runs", async () => {
    const runs = [makeRun({ id: "a" }), makeRun({ id: "b" })]
    mockInvoke.mockResolvedValueOnce(runs)
    await overdriveRunStore.loadRuns()
    expect(mockInvoke).toHaveBeenCalledWith("overdrive_list_runs", undefined)
    expect(overdriveRunStore.runs).toHaveLength(2)
  })

  it("actionableRuns filters to review/input/failed", async () => {
    mockInvoke.mockResolvedValueOnce([
      makeRun({ id: "a", status: "needsReview" }),
      makeRun({ id: "b", status: "working" }),
      makeRun({ id: "c", status: "failed" }),
      makeRun({ id: "d", status: "approved" }),
      makeRun({ id: "e", status: "needsInput" }),
    ])
    await overdriveRunStore.loadRuns()
    expect(overdriveRunStore.actionableRuns.map((r) => r.id).sort()).toEqual(["a", "c", "e"])
    expect(overdriveRunStore.actionableCount).toBe(3)
  })

  it("approve calls overdrive_approve_run and reloads on success", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "overdrive_approve_run")
        return Promise.resolve({ success: true, conflicts: [], message: "" })
      return Promise.resolve([])
    })
    await overdriveRunStore.approve("run-1")
    expect(
      mockInvoke.mock.calls.some(
        ([cmd, args]) =>
          cmd === "overdrive_approve_run" && (args as { runId: string }).runId === "run-1"
      )
    ).toBe(true)
    // reload issued after success
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_list_runs")).toBe(true)
  })

  it("approve does not reload on merge conflict", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "overdrive_approve_run")
        return Promise.resolve({ success: false, conflicts: ["a.ts"], message: "conflict" })
      return Promise.resolve([])
    })
    await overdriveRunStore.approve("run-1")
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_list_runs")).toBe(false)
  })

  it("reject calls overdrive_reject_run", async () => {
    mockInvoke.mockResolvedValue(undefined)
    await overdriveRunStore.reject("run-9")
    expect(
      mockInvoke.mock.calls.some(
        ([cmd, args]) =>
          cmd === "overdrive_reject_run" && (args as { runId: string }).runId === "run-9"
      )
    ).toBe(true)
  })
})
