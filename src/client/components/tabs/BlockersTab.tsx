import { useState } from "react";
import type { Blocker } from "../../../shared/protocol";
import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";

function BlockerCard({
  b,
  state,
  actions,
}: {
  b: Blocker;
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const role = state.you?.role ?? null;
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);

  const taskTitle = b.taskId ? (state.tasks.find((t) => t.id === b.taskId)?.title ?? "(deleted task)") : null;
  const comments = state.blockerComments
    .filter((c) => c.blockerId === b.id)
    .sort((a, c) => a.createdAt - c.createdAt);

  const canComment = role === "intern" || role === "mentor" || role === "manager";
  const canRequestResolution = role === "intern" && b.status === "OPEN";
  const canResolve = (role === "mentor" || role === "manager") && b.status !== "RESOLVED";
  const canEscalate = role === "manager" && b.status !== "RESOLVED";

  const submitComment = () => {
    if (!comment.trim()) return;
    actions.commentOnBlocker(b.id, comment.trim());
    setComment("");
  };

  return (
    <li className={`blocker-card ${b.status === "RESOLVED" ? "resolved" : ""}`}>
      <div className="blocker-card-head">
        <span className={`dot ${b.status === "RESOLVED" ? "ok" : "danger"}`} />
        <strong>{b.description}</strong>
        <span className={`badge status-${b.status.toLowerCase()}`}>{b.status.replace(/_/g, " ")}</span>
      </div>
      <p className="meta">
        raised by {b.createdByName || b.createdBy} · {timeAgo(b.createdAt)}
        {taskTitle && <> · task: {taskTitle}</>}
        {b.status !== "RESOLVED" && (
          <> · mentor {b.mentorResponded ? "responded" : "has not responded"}</>
        )}
        {b.status === "RESOLUTION_REQUESTED" && <> · awaiting mentor/manager confirmation</>}
      </p>

      {comments.length > 0 && (
        <ul className="list blocker-comments">
          {comments.map((c) => (
            <li key={c.id}>
              <span className="meta time">{timeAgo(c.createdAt)}</span>
              <strong>{c.authorName}</strong>
              {c.authorRole && <span className="meta"> ({c.authorRole})</span>}: {c.content}
            </li>
          ))}
        </ul>
      )}

      {b.status === "RESOLVED" ? (
        <p className="meta resolution-note">
          Resolved by {b.resolvedByName ?? b.resolvedBy} {b.resolvedAt ? timeAgo(b.resolvedAt) : ""}
          {b.resolutionNote && <> — “{b.resolutionNote}”</>}
        </p>
      ) : (
        <div className="blocker-actions">
          {canComment && (
            <div className="row">
              <input
                placeholder="Add an update or response…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitComment()}
              />
              <button disabled={!comment.trim()} onClick={submitComment}>
                Comment
              </button>
            </div>
          )}
          <div className="row">
            {canRequestResolution && (
              <button onClick={() => actions.requestBlockerResolution(b.id)}>Request resolution</button>
            )}
            {canResolve && !showResolve && (
              <button className="primary" onClick={() => setShowResolve(true)}>
                Resolve
              </button>
            )}
            {canEscalate && (
              <button
                className="danger"
                onClick={() => actions.escalateBlocker(b.id, "Escalated for visibility")}
              >
                Escalate
              </button>
            )}
          </div>
          {showResolve && (
            <div className="row">
              <input
                placeholder="Resolution note (required)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="primary"
                disabled={!note.trim()}
                onClick={() => {
                  actions.resolveBlocker(b.id, note.trim());
                  setNote("");
                  setShowResolve(false);
                }}
              >
                Confirm resolve
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function BlockersTab({
  state,
  actions,
}: {
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const role = state.you?.role ?? null;
  const canRaise = role === "intern";

  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState("");

  const open = state.blockers.filter((b) => b.status !== "RESOLVED");
  const resolved = state.blockers.filter((b) => b.status === "RESOLVED");

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
          <p className="meta">Only the intern can raise a new blocker — mentors/managers can comment, resolve, or escalate below.</p>
        )}
      </section>

      <section className="card">
        <h3>
          Open <span className="count danger">{open.length}</span>
        </h3>
        <ul className="list">
          {open.map((b) => (
            <BlockerCard key={b.id} b={b} state={state} actions={actions} />
          ))}
          {open.length === 0 && <li className="meta">No open blockers.</li>}
        </ul>
      </section>

      {resolved.length > 0 && (
        <section className="card">
          <h3>Recently resolved</h3>
          <ul className="list">
            {resolved.map((b) => (
              <BlockerCard key={b.id} b={b} state={state} actions={actions} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
