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
  const doneTasks = state.tasks.filter((t) => t.status === "DONE");
  const openBlockers = state.blockers.filter((b) => b.status === "OPEN");
  const recentFeedback = state.feedback.slice(0, 3);
  const openReminders = state.reminders.filter((r) => r.status === "OPEN");
  const weekly = [...state.weeklyReports].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  const indexingDocs = state.attachments.filter((a) => a.indexStatus === "pending").length;

  const nextActions: string[] = [];
  if (openBlockers.length > 0) nextActions.push(`Resolve or discuss ${openBlockers.length} open blocker(s).`);
  if (openReminders.length > 0) nextActions.push(`${openReminders.length} reminder(s) need acknowledgement.`);
  if (!weekly) nextActions.push("No weekly review started for this period yet.");
  else if (weekly.status === "DRAFT") nextActions.push("Weekly review is a draft — intern to edit and submit.");
  else if (weekly.status === "SUBMITTED") nextActions.push("Weekly review is awaiting mentor approval.");
  else if (weekly.status === "CHANGES_REQUESTED") nextActions.push("Mentor requested changes on the weekly review.");
  if (nextActions.length === 0) nextActions.push("Nothing outstanding — keep the updates coming.");

  return (
    <div className="grid-2">
      <section className="card span-2 next-actions">
        <h3>Next actions</h3>
        <ul className="list">
          {nextActions.map((a, i) => (
            <li key={i}>→ {a}</li>
          ))}
        </ul>
        <p className="meta">
          {activeTasks.length} active · {doneTasks.length} done ·{" "}
          {openBlockers.length} open blocker(s) ·{" "}
          {weekly ? `weekly: ${weekly.status}` : "no weekly report"}
          {indexingDocs > 0 && ` · ${indexingDocs} document(s) indexing`}
        </p>
      </section>
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
