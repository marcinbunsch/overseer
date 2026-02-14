import type { ToolCall } from "./parseToolCall"

interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed"
  activeForm: string
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return <span className="text-ovr-ok">✓</span>
  }
  if (status === "in_progress") {
    return <span className="inline-block size-2 rounded-full bg-ovr-azure-500 animate-pulse" />
  }
  return <span className="inline-block size-2 rounded-full border border-ovr-text-dim" />
}

export function TodoWriteToolItem({ tool }: { tool: ToolCall }) {
  const todos = Array.isArray(tool.input?.todos) ? (tool.input.todos as TodoItem[]) : []

  if (todos.length === 0) {
    return <div className="py-0.5 text-xs font-mono text-ovr-text-dim">TodoWrite</div>
  }

  const completed = todos.filter((t) => t.status === "completed").length

  return (
    <div className="py-0.5 text-xs">
      <div className="flex items-center gap-2 font-mono text-ovr-text-dim">
        <span>TodoWrite</span>
        <span className="text-ovr-text-muted">
          {completed}/{todos.length} done
        </span>
      </div>
      <div className="mt-1 ml-1 space-y-0.5">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-center gap-2">
            <StatusIcon status={todo.status} />
            <span
              className={
                todo.status === "completed"
                  ? "text-ovr-text-dim line-through"
                  : todo.status === "in_progress"
                    ? "text-ovr-text-primary"
                    : "text-ovr-text-muted"
              }
            >
              {todo.status === "in_progress" ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
