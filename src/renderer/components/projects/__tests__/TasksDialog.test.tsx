/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// Route this.backend.invoke (via the factory) to a mock.
const mockInvoke: Mock = vi.fn(() => Promise.resolve(undefined))
vi.mock("../../../backend", () => ({
  backend: { invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args) },
}))
vi.mock("../../../backend/factory", () => ({
  getBackendForProject: () => ({ invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args) }),
}))

import { TasksDialog } from "../TasksDialog"
import { ProjectStore } from "../../../stores/ProjectStore"
import type { Project } from "../../../types"

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "my-repo",
    path: "/home/user/my-repo",
    isGitRepo: true,
    workspaces: [],
    ...overrides,
  }
}

describe("TasksDialog", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
  })

  it("shows an empty state when the repo has no tasks", async () => {
    mockInvoke.mockResolvedValue([])
    const store = new ProjectStore(createProject())

    render(<TasksDialog open={true} onOpenChange={() => {}} project={store} />)

    await waitFor(() => expect(screen.getByTestId("tasks-empty")).toBeInTheDocument())
  })

  it("loads tasks when opened", async () => {
    mockInvoke.mockResolvedValue([])
    const store = new ProjectStore(createProject({ name: "my-repo" }))

    render(<TasksDialog open={true} onOpenChange={() => {}} project={store} />)

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("overdrive_list_tasks", { repo: "my-repo" })
    )
  })

  it("adds a task from the form", async () => {
    mockInvoke.mockResolvedValue([])
    const store = new ProjectStore(createProject())

    render(<TasksDialog open={true} onOpenChange={() => {}} project={store} />)

    fireEvent.change(screen.getByTestId("add-task-title"), { target: { value: "Fix the bug" } })
    fireEvent.click(screen.getByTestId("add-task-submit"))

    await waitFor(() => expect(screen.getByTestId("task-item")).toBeInTheDocument())
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_upsert_task")).toBe(true)
  })

  it("does not add a task with a blank title", async () => {
    mockInvoke.mockResolvedValue([])
    const store = new ProjectStore(createProject())

    render(<TasksDialog open={true} onOpenChange={() => {}} project={store} />)
    await waitFor(() => expect(screen.getByTestId("tasks-empty")).toBeInTheDocument())

    // Submit button is disabled with an empty title; clicking does nothing.
    fireEvent.click(screen.getByTestId("add-task-submit"))

    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_upsert_task")).toBe(false)
    expect(screen.getByTestId("tasks-empty")).toBeInTheDocument()
  })

  it("deletes a task", async () => {
    // Seed one task through the list command so loadTasks (on open) renders it.
    const seeded = {
      id: "task-1",
      repoId: "project-1",
      title: "doomed",
      description: "",
      status: "todo" as const,
      order: 0,
      createdAt: new Date().toISOString(),
    }
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "overdrive_list_tasks" ? Promise.resolve([seeded]) : Promise.resolve(undefined)
    )
    const store = new ProjectStore(createProject())

    render(<TasksDialog open={true} onOpenChange={() => {}} project={store} />)

    await waitFor(() => expect(screen.getByTestId("task-item")).toBeInTheDocument())
    fireEvent.click(screen.getByTestId("task-delete"))

    await waitFor(() => expect(screen.queryByTestId("task-item")).not.toBeInTheDocument())
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "overdrive_delete_task")).toBe(true)
  })
})
