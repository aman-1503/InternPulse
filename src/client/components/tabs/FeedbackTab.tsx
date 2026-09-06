import { useState } from "react";
import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";

export function FeedbackTab({
  state,
  actions,
}: {
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const canGive = state.you?.role === "mentor";
  const [content, setContent] = useState("");
  const [taskId, setTaskId] = useState("");

  const taskTitle = (id: string | null) =>
    id ? (state.tasks.find((t) => t.id === id)?.title ?? "(deleted task)") : null;

  return (
    <div>
      <section className="card">
        <h3>Add mentor feedback</h3>
        {canGive ? (
          <div className="stack">
            <textarea
              rows={3}
              placeholder="Feedback for the intern"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="row">
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">General feedback</option>
                {state.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    About: {t.title}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!content.trim()}
                onClick={() => {
                  actions.postFeedback(content.trim(), taskId || null);
                  setContent("");
                  setTaskId("");
                }}
              >
                Post feedback
              </button>
            </div>
          </div>
        ) : (
          <p className="meta">Only mentors can add feedback.</p>
        )}
      </section>

      <section className="card">
        <h3>Feedback history</h3>
        <ul className="list feed">
          {state.feedback.map((f) => (
            <li key={f.id}>
              <div>
                <strong>{f.authorName}</strong>
                {f.taskId && <span className="meta"> · on {taskTitle(f.taskId)}</span>}
                <span className="meta"> · {timeAgo(f.createdAt)}</span>
              </div>
              <div>{f.content}</div>
            </li>
          ))}
          {state.feedback.length === 0 && <li className="meta">No feedback yet.</li>}
        </ul>
      </section>
    </div>
  );
}
