import { useState, useEffect } from "react"
import { observer } from "mobx-react-lite"
import * as AlertDialog from "@radix-ui/react-alert-dialog"
import { X, ArrowUp, ArrowDown, Pencil, Trash2 } from "lucide-react"
import { Input } from "../shared/Input"
import { Textarea } from "../shared/Textarea"
import { Checkbox } from "../shared/Checkbox"
import type { ProjectStore } from "../../stores/ProjectStore"
import type { OverdriveTask } from "../../types"

interface TasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectStore
}

interface TaskFormValues {
  title: string
  description: string
  verification: string
  expectGreenHarness: boolean
}

const EMPTY_FORM: TaskFormValues = {
  title: "",
  description: "",
  verification: "",
  expectGreenHarness: false,
}

export const TasksDialog = observer(function TasksDialog({
  open,
  onOpenChange,
  project,
}: TasksDialogProps) {
  const [form, setForm] = useState<TaskFormValues>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (open) project.loadTasks()
  }, [open, project])

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const startEdit = (task: OverdriveTask) => {
    setEditingId(task.id)
    setForm({
      title: task.title,
      description: task.description,
      verification: task.verification ?? "",
      expectGreenHarness: task.expectGreenHarness ?? false,
    })
  }

  const handleSubmit = async () => {
    if (!form.title.trim()) return
    if (editingId) {
      const existing = project.tasks.find((t) => t.id === editingId)
      if (existing) {
        await project.updateTask({
          ...existing,
          title: form.title.trim(),
          description: form.description.trim(),
          verification: form.verification.trim() || undefined,
          expectGreenHarness: form.expectGreenHarness,
        })
      }
    } else {
      await project.addTask({
        title: form.title,
        description: form.description,
        verification: form.verification,
        expectGreenHarness: form.expectGreenHarness,
      })
    }
    resetForm()
  }

  const tasks = project.sortedTasks

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-160 -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-ovr-border-subtle bg-ovr-bg-panel p-6 shadow-ovr-panel">
          <div className="flex items-center justify-between">
            <AlertDialog.Title className="text-sm font-semibold text-ovr-text-strong">
              Tasks — {project.name}
            </AlertDialog.Title>
            <AlertDialog.Cancel asChild>
              <button className="rounded p-1 text-ovr-text-dim hover:text-ovr-text-muted">
                <X className="size-4" />
              </button>
            </AlertDialog.Cancel>
          </div>

          {/* Task list */}
          <div className="mt-4 flex-1 overflow-y-auto">
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-xs text-ovr-text-dim" data-testid="tasks-empty">
                No tasks yet. Add one below.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {tasks.map((task, i) => (
                  <div
                    key={task.id}
                    data-testid="task-item"
                    className="flex items-start gap-2 rounded-lg border border-ovr-border-subtle bg-ovr-bg-elevated px-3 py-2"
                  >
                    <div className="flex shrink-0 flex-col">
                      <button
                        data-testid="task-move-up"
                        disabled={i === 0}
                        onClick={() => project.moveTask(task.id, "up")}
                        className="text-ovr-text-dim hover:text-ovr-text-muted disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        data-testid="task-move-down"
                        disabled={i === tasks.length - 1}
                        onClick={() => project.moveTask(task.id, "down")}
                        className="text-ovr-text-dim hover:text-ovr-text-muted disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ovr-text-strong">
                        {task.title}
                      </div>
                      {task.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-ovr-text-dim">
                          {task.description}
                        </div>
                      )}
                      <div className="mt-1 flex gap-1.5 text-[10px] text-ovr-text-dim">
                        <span className="rounded bg-ovr-bg-panel px-1.5 py-0.5">{task.status}</span>
                        {task.verification && (
                          <span className="rounded bg-ovr-bg-panel px-1.5 py-0.5">verified</span>
                        )}
                        {task.expectGreenHarness && (
                          <span className="rounded bg-ovr-bg-panel px-1.5 py-0.5">green-start</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        data-testid="task-edit"
                        onClick={() => startEdit(task)}
                        className="text-ovr-text-dim hover:text-ovr-text-muted"
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        data-testid="task-delete"
                        onClick={() => project.deleteTask(task.id)}
                        className="text-ovr-text-dim hover:text-ovr-danger"
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add / edit form */}
          <div className="mt-4 flex flex-col gap-2 border-t border-ovr-border-subtle pt-4">
            <p className="text-xs font-medium text-ovr-text-muted">
              {editingId ? "Edit task" : "New task"}
            </p>
            <Input
              data-testid="add-task-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task title"
              className="w-full text-xs"
            />
            <Textarea
              data-testid="add-task-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description (what needs doing)"
              rows={2}
              className="w-full resize-y text-xs"
            />
            <Textarea
              data-testid="add-task-verification"
              value={form.verification}
              onChange={(e) => setForm({ ...form, verification: e.target.value })}
              placeholder="Verification criteria (optional)"
              rows={2}
              className="w-full resize-y text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-ovr-text-muted">
              <Checkbox
                data-testid="add-task-green"
                checked={form.expectGreenHarness}
                onChange={(e) => setForm({ ...form, expectGreenHarness: e.target.checked })}
              />
              Expect harness green from the start (refactor)
            </label>
            <div className="flex justify-end gap-2">
              {editingId && (
                <button
                  className="ovr-btn-ghost cursor-pointer px-3 py-1.5 text-xs"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              )}
              <button
                data-testid="add-task-submit"
                className="ovr-btn-primary cursor-pointer px-3 py-1.5 text-xs"
                onClick={handleSubmit}
                disabled={!form.title.trim()}
              >
                {editingId ? "Save" : "Add task"}
              </button>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
})
