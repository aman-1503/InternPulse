import { useState } from "react";
import { TASK_STATUSES, type Task, type TaskStatus } from "../../../shared/protocol";
import type { WorkspaceActions } from "../../lib/useWorkspace";
import { TaskEditor, type TaskDraft } from "./TaskEditor";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const DND_TYPE = "text/x-internpulse-task";

export function Board({
  tasks,
  canEdit,
  actions,
}: {
  tasks: Task[];
  canEdit: boolean;
  actions: WorkspaceActions;
}) {
  const [editing, setEditing] = useState<Task | "new" | null>(null);

  const save = (draft: TaskDraft) => {
    if (editing === "new") {
      actions.createTask(draft);
    } else if (editing) {
      actions.updateTask(editing.id, draft);
    }
    setEditing(null);
  };

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        {canEdit ? (
          <button className="primary" onClick={() => setEditing("new")}>
            + New task
          </button>
        ) : (
          <span className="meta">Your role can view the board but not change it.</span>
        )}
      </div>

      {editing && (
        <TaskEditor
          task={editing === "new" ? null : editing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="board">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasks.filter((t) => t.status === status)}
            canEdit={canEdit}
            onDropTask={(id) => actions.moveTask(id, status)}
            onEdit={setEditing}
            onDelete={(id) => {
              if (confirm("Delete this task?")) actions.deleteTask(id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Column({
  status,
  tasks,
  canEdit,
  onDropTask,
  onEdit,
  onDelete,
}: {
  status: TaskStatus;
  tasks: Task[];
  canEdit: boolean;
  onDropTask: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <section
      className={`column${over ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DND_TYPE);
        if (id) onDropTask(id);
      }}
    >
      <header>
        {COLUMN_LABEL[status]}
        <span className="count">{tasks.length}</span>
      </header>
      <div className="column-body">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            canEdit={canEdit}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        {tasks.length === 0 && <p className="meta empty">—</p>}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  canEdit,
  onEdit,
  onDelete,
}: {
  task: Task;
  canEdit: boolean;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}) {
  return (
    <article
      className="task-card"
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="task-card-title">{task.title}</div>
      {task.description && <div className="task-card-desc">{task.description}</div>}
      <div className="task-card-foot">
        {task.priority && <span className={`badge pri-${task.priority}`}>{task.priority}</span>}
        {canEdit && (
          <span className="task-card-actions">
            <button onClick={() => onEdit(task)}>edit</button>
            <button onClick={() => onDelete(task.id)}>delete</button>
          </span>
        )}
      </div>
    </article>
  );
}
