import type { WorkspaceState } from "../../lib/useWorkspace";
import type { WorkspaceActions } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { Composer } from "../Composer";

/** "Today / Overview" — the at-a-glance state of the internship. */
export function OverviewTab({
  state,
  actions,
}: {
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const role = state.you?.role ?? null;
  const latestDaily = state.updates.find((u) => u.type === "DAILY") ?? state.updates[0] ?? null;
  const activeTasks = state.tasks.filter((t) => t.status !== "DONE");
  const openBlockers = state.blockers.filter((b) => b.status === "OPEN");
  const recentFeedback = state.feedback.slice(0, 3);

  return (
    <div className="grid-2">
      <section className="card">
        <h3>Latest update</h3>
        {latestDaily ? (
          <>
            <p className="update-body">{latestDaily.content}</p>
            <p className="meta">
              <span className={`badge type-${latestDaily.type}`}>{latestDaily.type}</span>{" "}
              {latestDaily.authorName} · {timeAgo(latestDaily.createdAt)}
            </p>
          </>
        ) : (
          <p className="meta">No updates yet.</p>
        )}
        <Composer
          placeholder="What are you working on today?"
          buttonLabel="Post daily update"
          onSubmit={(text) => actions.postUpdate(text, "DAILY")}
          disabled={role === null}
          disabledHint="Join this workspace to post updates."
        />
      </section>

      <section className="card">
        <h3>
          Blockers <span className="count danger">{openBlockers.length}</span>
        </h3>
        {openBlockers.length === 0 && <p className="meta">Nothing blocking right now.</p>}
        <ul className="list">
          {openBlockers.map((b) => (
            <li key={b.id}>
              <span className="dot danger" /> {b.description}
              <span className="meta"> · {timeAgo(b.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>
          Active tasks <span className="count">{activeTasks.length}</span>
        </h3>
        <ul className="list">
          {activeTasks.slice(0, 8).map((t) => (
            <li key={t.id}>
              <span className={`badge status-${t.status}`}>{t.status}</span> {t.title}
            </li>
          ))}
          {activeTasks.length === 0 && <li className="meta">No active tasks.</li>}
        </ul>
      </section>

      <section className="card">
        <h3>Recent feedback</h3>
        <ul className="list">
          {recentFeedback.map((f) => (
            <li key={f.id}>
              <strong>{f.authorName}:</strong> {f.content}
              <span className="meta"> · {timeAgo(f.createdAt)}</span>
            </li>
          ))}
          {recentFeedback.length === 0 && <li className="meta">No feedback yet.</li>}
        </ul>
      </section>

      <section className="card span-2">
        <h3>Update history</h3>
        <ul className="list feed">
          {state.updates.slice(0, 10).map((u) => (
            <li key={u.id}>
              <div>
                <span className={`badge type-${u.type}`}>{u.type}</span>{" "}
                <strong>{u.authorName}</strong>
                <span className="meta"> · {timeAgo(u.createdAt)}</span>
              </div>
              <div>{u.content}</div>
            </li>
          ))}
          {state.updates.length === 0 && <li className="meta">No updates yet.</li>}
        </ul>
      </section>
    </div>
  );
}
