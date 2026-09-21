import { useState } from "react";
import { TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskPriority, type TaskStatus } from "../../../shared/protocol";
import { btn, card, cn, input, row, select, textarea } from "../../ui/primitives";

export interface TaskDraft {
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  dueDate: number | null;
  status: TaskStatus;
}

function toDateInputValue(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inline create/edit panel. No modal library — just a bordered form. */
export function TaskEditor({
  task,
  onSave,
  onClose,
}: {
  task: Task | null;
  onSave: (draft: TaskDraft) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority | "">(task?.priority ?? "");
  const [dueDate, setDueDate] = useState(toDateInputValue(task?.dueDate ?? null));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "TODO");

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      priority: priority || null,
      dueDate: dueDate ? new Date(`${dueDate}T00:00:00`).getTime() : null,
      status,
    });
  };

  return (
    <div className={cn(card, "flex flex-col gap-2")}>
      <div className="text-sm font-semibold text-text">{task ? "Edit task" : "New task"}</div>
      <label className="text-sm font-medium" htmlFor="task-title">
        Title
      </label>
      <input id="task-title" className={input} value={title} autoFocus onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <label className="text-sm font-medium" htmlFor="task-description">
        Description
      </label>
      <textarea
        id="task-description"
        className={textarea}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={2000}
      />
      <div className={row}>
        <div className="flex-1">
          <label className="text-sm font-medium" htmlFor="task-priority">
            Priority
          </label>
          <select id="task-priority" className={select} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | "")}>
            <option value="">none</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium" htmlFor="task-due-date">
            Due date
          </label>
          <input id="task-due-date" type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        {task && (
          <div className="flex-1">
            <label className="text-sm font-medium" htmlFor="task-status">
              Status
            </label>
            <select id="task-status" className={select} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className={row}>
        <button className={btn("primary")} disabled={!title.trim()} onClick={submit}>
          {task ? "Save" : "Create"}
        </button>
        <button className={btn("default")} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
