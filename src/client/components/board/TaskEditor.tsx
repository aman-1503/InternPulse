import { useState } from "react";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../shared/protocol";

export interface TaskDraft {
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  status: TaskStatus;
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
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "TODO");

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      priority: priority || null,
      status,
    });
  };

  return (
    <div className="editor card">
      <div className="editor-head">{task ? "Edit task" : "New task"}</div>
      <label>Title</label>
      <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      <label>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={2000}
      />
      <div className="row">
        <div>
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | "")}>
            <option value="">none</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {task && (
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="row editor-actions">
        <button className="primary" disabled={!title.trim()} onClick={submit}>
          {task ? "Save" : "Create"}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
