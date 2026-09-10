import type { WorkspaceState } from "../../lib/useWorkspace";
import type { WorkspaceActions } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { Composer } from "../Composer";

/** Role-curated "home" for this workspace — same underlying data, different lens per spec. */
export function OverviewTab({
  state,
  actions,
}: {
  state: WorkspaceState;
  actions: WorkspaceActions;
}) {
  const role = state.you?.role ?? null;
  const userId = state.you?.userId ?? "";
  const latestDaily = state.updates.find((u) => u.type === "DAILY") ?? state.updates[0] ?? null;
  const activeTasks = state.tasks.filter((t) => t.status !== "DONE");
  const doneTasks = state.tasks.filter((t) => t.status === "DONE");
  const openBlockers = state.blockers.filter((b) => b.status !== "RESOLVED");
  const recentFeedback = state.feedback.slice(0, 3);
  const weekly = [...state.weeklyReports].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  const indexingDocs = state.attachments.filter((a) => a.indexStatus === "pending").length;
  const attention = state.attentionItems;
  const unreadMentions = state.mentions.filter((m) => !m.readAt);

  const myTasks = state.tasks.filter((t) => t.assigneeId === userId || (!t.assigneeId && t.createdBy === userId));
  const myUrgent = myTasks.filter((t) => (t.priority === "URGENT" || t.priority === "HIGH") && t.status !== "DONE");
  const myOverdue = myTasks.filter((t) => t.dueDate && t.dueDate < Date.now() && t.status !== "DONE");

  const nextActions: string[] = attention.slice(0, 5).map((a) => a.title);
  if (nextActions.length === 0) nextActions.push("Nothing outstanding — keep the updates coming.");

  return (
    <div className="grid-2">
      <section className="card span-2 next-actions">
        <h3>{role === "manager" ? "Needs escalation" : role === "mentor" ? "Needs your attention" : "Next actions"}</h3>
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

      {unreadMentions.length > 0 && (
        <section className="card span-2">
          <h3>
            Mentions <span className="count danger">{unreadMentions.length}</span>
          </h3>
          <ul className="list">
            {unreadMentions.map((m) => (
              <li key={m.id}>
                <strong>{m.mentionedByName}</strong> mentioned you: “{m.snippet}”
                <span className="meta"> · {timeAgo(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {role === "intern" && (
        <>
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
              My urgent/high tasks <span className="count danger">{myUrgent.length}</span>
            </h3>
            <ul className="list">
              {myUrgent.map((t) => (
                <li key={t.id}>
                  <span className={`badge pri-${t.priority}`}>{t.priority}</span> {t.title}
                </li>
              ))}
              {myUrgent.length === 0 && <li className="meta">None right now.</li>}
            </ul>
            {myOverdue.length > 0 && (
              <p className="meta overdue-text">{myOverdue.length} overdue task(s).</p>
            )}
          </section>
        </>
      )}

      {role === "mentor" && (
        <section className="card">
          <h3>Weekly reports waiting for review</h3>
          <ul className="list">
            {state.weeklyReports
              .filter((r) => r.status === "SUBMITTED" || r.status === "RESUBMITTED")
              .map((r) => (
                <li key={r.id}>
                  {r.reportingPeriod} <span className="meta">· round {r.round}</span>
                </li>
              ))}
            {state.weeklyReports.filter((r) => r.status === "SUBMITTED" || r.status === "RESUBMITTED").length === 0 && (
              <li className="meta">Nothing waiting.</li>
            )}
          </ul>
        </section>
      )}

      {role === "manager" && (
        <section className="card">
          <h3>Approved reports</h3>
          <ul className="list">
            {state.weeklyReports
              .filter((r) => r.status === "APPROVED")
              .slice(0, 5)
              .map((r) => (
                <li key={r.id}>
                  {r.reportingPeriod} {r.overriddenBy && <span className="badge warn">override</span>}
                </li>
              ))}
            {state.weeklyReports.filter((r) => r.status === "APPROVED").length === 0 && (
              <li className="meta">None approved yet.</li>
            )}
          </ul>
        </section>
      )}

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
              {role !== "intern" && !b.mentorResponded && b.status !== "RESOLVED" && (
                <span className="badge warn"> no mentor response</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>
          {role === "intern" ? "My tasks" : "Active tasks"} <span className="count">{activeTasks.length}</span>
        </h3>
        <ul className="list">
          {(role === "intern" ? myTasks.filter((t) => t.status !== "DONE") : activeTasks).slice(0, 8).map((t) => (
            <li key={t.id}>
              <span className={`badge status-${t.status}`}>{t.status}</span> {t.title}
              {t.dueDate && t.dueDate < Date.now() && t.status !== "DONE" && (
                <span className="badge warn"> overdue</span>
              )}
            </li>
          ))}
          {activeTasks.length === 0 && <li className="meta">No active tasks.</li>}
        </ul>
      </section>

      <section className="card">
        <h3>{role === "intern" ? "Mentor feedback" : "Recent feedback"}</h3>
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
