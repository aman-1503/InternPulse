import { useState } from "react";
import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { btn, card, cn, meta, row, sectionTitle, select, textarea } from "../../ui/primitives";

export function FeedbackTab({ state, actions }: { state: WorkspaceState; actions: WorkspaceActions }) {
  const canGive = state.you?.role === "mentor";
  const [content, setContent] = useState("");
  const [taskId, setTaskId] = useState("");

  const taskTitle = (id: string | null) => (id ? (state.tasks.find((t) => t.id === id)?.title ?? "(deleted task)") : null);

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h3 className={sectionTitle}>Add mentor feedback</h3>
        {canGive ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              className={textarea}
              rows={3}
              placeholder="Feedback for the intern"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className={row}>
              <select className={select} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">General feedback</option>
                {state.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    About: {t.title}
                  </option>
                ))}
              </select>
              <button
                className={btn("primary")}
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
          <p className={cn(meta, "mt-2")}>Only mentors can add feedback.</p>
        )}
      </section>

      <section className={card}>
        <h3 className={sectionTitle}>Feedback history</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {state.feedback.map((f) => (
            <li key={f.id}>
              <div>
                <strong>{f.authorName}</strong>
                {f.taskId && <span className={meta}> · on {taskTitle(f.taskId)}</span>}
                <span className={meta}> · {timeAgo(f.createdAt)}</span>
              </div>
              <div>{f.content}</div>
            </li>
          ))}
          {state.feedback.length === 0 && <li className={meta}>No feedback yet.</li>}
        </ul>
      </section>
    </div>
  );
}
