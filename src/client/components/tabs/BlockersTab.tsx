import { useState } from "react";
import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";

export function BlockersTab({
  state,
  actions,
}: {
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const role = state.you?.role ?? null;
  const canRaise = role === "intern" || role === "mentor" || role === "manager";
  const canResolve = role === "mentor";

  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState("");

  const open = state.blockers.filter((b) => b.status === "OPEN");
  const resolved = state.blockers.filter((b) => b.status === "RESOLVED");
  const taskTitle = (id: string | null) =>
    id ? (state.tasks.find((t) => t.id === id)?.title ?? "(deleted task)") : null;

  return (
    <div>
      <section className="card">
        <h3>Raise a blocker</h3>
        {canRaise ? (
          <div className="stack">
            <textarea
              rows={2}
              placeholder="Describe what's blocking you (required)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="row">
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Not linked to a task</option>
                {state.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!description.trim()}
                onClick={() => {
                  actions.createBlocker(description.trim(), taskId || null);
                  setDescription("");
                  setTaskId("");
                }}
              >
                Raise blocker
              </button>
            </div>
          </div>
        ) : (
          <p className="meta">Join this workspace to raise blockers.</p>
        )}
      </section>

      <section className="card">
        <h3>
          Open <span className="count danger">{open.length}</span>
        </h3>
        <ul className="list">
          {open.map((b) => (
            <li key={b.id} className="blocker-row">
              <div>
                <span className="dot danger" /> {b.description}
                {b.taskId && <span className="meta"> · task: {taskTitle(b.taskId)}</span>}
                <span className="meta"> · raised {timeAgo(b.createdAt)}</span>
              </div>
              {canResolve && (
                <button onClick={() => actions.resolveBlocker(b.id)}>Resolve</button>
              )}
            </li>
          ))}
          {open.length === 0 && <li className="meta">No open blockers.</li>}
        </ul>
      </section>

      {resolved.length > 0 && (
        <section className="card">
          <h3>Recently resolved</h3>
          <ul className="list">
            {resolved.map((b) => (
              <li key={b.id} className="resolved">
                <span className="dot ok" /> {b.description}
                <span className="meta">
                  {" "}
                  · resolved {b.resolvedAt ? timeAgo(b.resolvedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
