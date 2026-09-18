import { useState } from "react";
import { TASK_STATUSES, type Role, type Task, type TaskPriority, type TaskStatus } from "../../../shared/protocol";
import type { WorkspaceActions } from "../../lib/useWorkspace";
import { TaskEditor, type TaskDraft } from "./TaskEditor";
import { btn, cn, meta, select } from "../../ui/primitives";
import { PriorityBadge } from "../../ui/badges";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const DND_TYPE = "text/x-internpulse-task";

function ownsTask(task: Task, userId: string): boolean {
  return task.assigneeId ? task.assigneeId === userId : task.createdBy === userId;
}

export function Board({
  tasks,
  role,
  userId,
  commentCounts,
  actions,
}: {
  tasks: Task[];
  role: Role | null;
  userId: string;
  commentCounts: Record<string, number>;
  actions: WorkspaceActions;
}) {
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const canCreate = role === "intern";
  const canPriorityOnly = role === "mentor" || role === "manager";

  const canFullyEdit = (task: Task) => role === "intern" && ownsTask(task, userId);

  const save = (draft: TaskDraft) => {
    if (editing === "new") {
      actions.createTask(draft);
    } else if (editing) {
      actions.updateTask(editing.id, draft);
    }
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {canCreate ? (
          <button className={btn("primary")} onClick={() => setEditing("new")}>
            + New task
          </button>
        ) : canPriorityOnly ? (
          <span className={meta}>You can change task priority but not rewrite the intern's task status.</span>
        ) : (
          <span className={meta}>Your role can view the board but not change it.</span>
        )}
      </div>

      {editing && <TaskEditor task={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}

      {/* Stacks vertically on narrow screens — no touch drag/drop implemented, so a
          stacked list is the intended narrow-viewport experience, not a degraded board. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:overflow-x-auto">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasks.filter((t) => t.status === status)}
            canDrop={(t) => canFullyEdit(t)}
            canPriorityOnly={canPriorityOnly}
            commentCounts={commentCounts}
            onDropTask={(id) => actions.moveTask(id, status)}
            onEdit={setEditing}
            onDelete={(id) => {
              if (confirm("Delete this task?")) actions.deleteTask(id);
            }}
            onPriority={(id, priority) => actions.setTaskPriority(id, priority)}
          />
        ))}
      </div>
    </div>
  );
}

function Column({
  status,
  tasks,
  canDrop,
  canPriorityOnly,
  commentCounts,
  onDropTask,
  onEdit,
  onDelete,
  onPriority,
}: {
  status: TaskStatus;
  tasks: Task[];
  canDrop: (task: Task) => boolean;
  canPriorityOnly: boolean;
  commentCounts: Record<string, number>;
  onDropTask: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onPriority: (taskId: string, priority: TaskPriority) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-2 md:w-72 md:shrink-0",
        over && "border-accent bg-accent-muted/40",
      )}
      onDragOver={(e) => {
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
      <header className="flex items-center justify-between px-1 text-sm font-semibold text-text">
        {COLUMN_LABEL[status]}
        <span className={meta}>{tasks.length}</span>
      </header>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            canEdit={canDrop(task)}
            canPriorityOnly={canPriorityOnly}
            commentCount={commentCounts[task.id] ?? 0}
            onEdit={onEdit}
            onDelete={onDelete}
            onPriority={onPriority}
          />
        ))}
        {tasks.length === 0 && <p className={cn(meta, "px-1 py-2")}>—</p>}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  canEdit,
  canPriorityOnly,
  commentCount,
  onEdit,
  onDelete,
  onPriority,
}: {
  task: Task;
  canEdit: boolean;
  canPriorityOnly: boolean;
  commentCount: number;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onPriority: (taskId: string, priority: TaskPriority) => void;
}) {
  const overdue = !!task.dueDate && task.dueDate < Date.now() && task.status !== "DONE";
  return (
    <article
      className={cn(
        "cursor-default rounded-lg border bg-surface p-3 text-sm shadow-sm",
        overdue ? "border-danger/40" : "border-border",
        canEdit && "cursor-grab active:cursor-grabbing",
      )}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="font-medium text-text">{task.title}</div>
      {task.description && <div className={cn(meta, "mt-1")}>{task.description}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        {task.dueDate && (
          <span className={cn("text-xs", overdue ? "text-danger" : "text-muted")}>
            {overdue ? "overdue " : "due "}
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
        {commentCount > 0 && <span className={meta}>💬 {commentCount}</span>}
        {canPriorityOnly && (
          <select
            className={cn(select, "h-7 w-auto py-0 text-xs")}
            value={task.priority ?? ""}
            onChange={(e) => e.target.value && onPriority(task.id, e.target.value as TaskPriority)}
          >
            <option value="" disabled>
              set priority
            </option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="URGENT">URGENT</option>
          </select>
        )}
        {canEdit && (
          <span className="ml-auto flex gap-2 text-xs">
            <button className="text-accent hover:underline" onClick={() => onEdit(task)}>
              edit
            </button>
            <button className="text-danger hover:underline" onClick={() => onDelete(task.id)}>
              delete
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
