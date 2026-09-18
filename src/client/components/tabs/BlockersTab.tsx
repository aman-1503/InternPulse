import { useRef, useState } from "react";
import type { Blocker } from "../../../shared/protocol";
import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { btn, card, cn, input, meta, row, select, sectionTitle, textarea } from "../../ui/primitives";
import { BlockerStatusBadge } from "../../ui/badges";
import { useMentionSuggestions } from "../../ui/useMentionSuggestions";
import { MentionSuggestions } from "../../ui/MentionSuggestions";

function BlockerCard({ b, state, actions }: { b: Blocker; state: WorkspaceState; actions: WorkspaceActions }) {
  const role = state.you?.role ?? null;
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLInputElement | null>(null);
  const mention = useMentionSuggestions(comment, setComment, state.members, commentRef);
  const [note, setNote] = useState("");
  const [showResolve, setShowResolve] = useState(false);

  const taskTitle = b.taskId ? (state.tasks.find((t) => t.id === b.taskId)?.title ?? "(deleted task)") : null;
  const comments = state.blockerComments.filter((c) => c.blockerId === b.id).sort((a, c) => a.createdAt - c.createdAt);

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
    <li className={cn(card, b.status === "RESOLVED" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", b.status === "RESOLVED" ? "bg-success" : "bg-danger")} />
        <strong className="text-sm">{b.description}</strong>
        <BlockerStatusBadge status={b.status} />
      </div>
      <p className={cn(meta, "mt-1")}>
        raised by {b.createdByName || b.createdBy} · {timeAgo(b.createdAt)}
        {taskTitle && <> · task: {taskTitle}</>}
        {b.status !== "RESOLVED" && <> · mentor {b.mentorResponded ? "responded" : "has not responded"}</>}
        {b.status === "RESOLUTION_REQUESTED" && <> · awaiting mentor/manager confirmation</>}
      </p>

      {comments.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 text-sm">
          {comments.map((c) => (
            <li key={c.id}>
              <span className={meta}>{timeAgo(c.createdAt)}</span> <strong>{c.authorName}</strong>
              {c.authorRole && <span className={meta}> ({c.authorRole})</span>}: {c.content}
            </li>
          ))}
        </ul>
      )}

      {b.status === "RESOLVED" ? (
        <p className={cn(meta, "mt-2")}>
          Resolved by {b.resolvedByName ?? b.resolvedBy} {b.resolvedAt ? timeAgo(b.resolvedAt) : ""}
          {b.resolutionNote && <> — "{b.resolutionNote}"</>}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {canComment && (
            <div className={row}>
              <input
                ref={commentRef}
                className={cn(input, "flex-1")}
                placeholder="Add an update or response… (type @ to mention someone)"
                value={comment}
                onChange={mention.onFieldChange}
                onKeyUp={mention.onFieldKeyUp}
                onKeyDown={(e) => e.key === "Enter" && !mention.open && submitComment()}
              />
              <button className={btn("default")} disabled={!comment.trim()} onClick={submitComment}>
                Comment
              </button>
              <MentionSuggestions
                open={mention.open}
                triggerRef={commentRef}
                suggestions={mention.suggestions}
                onPick={mention.insert}
                onClose={mention.close}
              />
            </div>
          )}
          <div className={row}>
            {canRequestResolution && (
              <button className={btn("default")} onClick={() => actions.requestBlockerResolution(b.id)}>
                Request resolution
              </button>
            )}
            {canResolve && !showResolve && (
              <button className={btn("primary")} onClick={() => setShowResolve(true)}>
                Resolve
              </button>
            )}
            {canEscalate && (
              <button className={btn("danger")} onClick={() => actions.escalateBlocker(b.id, "Escalated for visibility")}>
                Escalate
              </button>
            )}
          </div>
          {showResolve && (
            <div className={row}>
              <input
                className={cn(input, "flex-1")}
                placeholder="Resolution note (required)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className={btn("primary")}
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

export function BlockersTab({ state, actions }: { state: WorkspaceState; actions: WorkspaceActions }) {
  const role = state.you?.role ?? null;
  const canRaise = role === "intern";

  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState("");

  const open = state.blockers.filter((b) => b.status !== "RESOLVED");
  const resolved = state.blockers.filter((b) => b.status === "RESOLVED");

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h3 className={sectionTitle}>Raise a blocker</h3>
        {canRaise ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              className={textarea}
              rows={2}
              placeholder="Describe what's blocking you (required)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className={row}>
              <select className={select} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">Not linked to a task</option>
                {state.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button
                className={btn("primary")}
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
          <p className={cn(meta, "mt-2")}>
            Only the intern can raise a new blocker — mentors/managers can comment, resolve, or escalate below.
          </p>
        )}
      </section>

      <section className={card}>
        <h3 className={sectionTitle}>Open ({open.length})</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {open.map((b) => (
            <BlockerCard key={b.id} b={b} state={state} actions={actions} />
          ))}
          {open.length === 0 && <li className={meta}>No open blockers.</li>}
        </ul>
      </section>

      {resolved.length > 0 && (
        <section className={card}>
          <h3 className={sectionTitle}>Recently resolved</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {resolved.map((b) => (
              <BlockerCard key={b.id} b={b} state={state} actions={actions} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
