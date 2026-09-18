import type { WorkspaceActions, WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { Composer } from "../Composer";
import { card, cn, meta, sectionTitle } from "../../ui/primitives";
import { PriorityBadge, TaskStatusBadge, WarnBadge } from "../../ui/badges";

/** Role-curated "home" for this workspace — same underlying data, different lens per spec. */
export function OverviewTab({ state, actions }: { state: WorkspaceState; actions: WorkspaceActions }) {
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
    <div className="grid gap-4 md:grid-cols-2">
      <section className={cn(card, "md:col-span-2")}>
        <h3 className={sectionTitle}>
          {role === "manager" ? "Needs escalation" : role === "mentor" ? "Needs your attention" : "Next actions"}
        </h3>
        <ul className="mt-2 space-y-1 text-sm">
          {nextActions.map((a, i) => (
            <li key={i}>→ {a}</li>
          ))}
        </ul>
        <p className={cn(meta, "mt-2")}>
          {activeTasks.length} active · {doneTasks.length} done · {openBlockers.length} open blocker(s) ·{" "}
          {weekly ? `weekly: ${weekly.status}` : "no weekly report"}
          {indexingDocs > 0 && ` · ${indexingDocs} document(s) indexing`}
        </p>
      </section>

      {unreadMentions.length > 0 && (
        <section className={cn(card, "md:col-span-2")}>
          <h3 className={sectionTitle}>
            Mentions <span className="text-danger">({unreadMentions.length})</span>
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {unreadMentions.map((m) => (
              <li key={m.id}>
                <strong>{m.mentionedByName}</strong> mentioned you: "{m.snippet}"
                <span className={meta}> · {timeAgo(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {role === "intern" && (
        <>
          <section className={card}>
            <h3 className={sectionTitle}>Latest update</h3>
            {latestDaily ? (
              <>
                <p className="mt-2 text-sm">{latestDaily.content}</p>
                <p className={cn(meta, "mt-1")}>
                  {latestDaily.type} · {latestDaily.authorName} · {timeAgo(latestDaily.createdAt)}
                </p>
              </>
            ) : (
              <p className={cn(meta, "mt-2")}>No updates yet.</p>
            )}
            <div className="mt-3">
              <Composer
                placeholder="What are you working on today?"
                buttonLabel="Post daily update"
                onSubmit={(text) => actions.postUpdate(text, "DAILY")}
                disabled={role === null}
                disabledHint="Join this workspace to post updates."
              />
            </div>
          </section>
          <section className={card}>
            <h3 className={sectionTitle}>My urgent/high tasks ({myUrgent.length})</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {myUrgent.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <PriorityBadge priority={t.priority} /> {t.title}
                </li>
              ))}
              {myUrgent.length === 0 && <li className={meta}>None right now.</li>}
            </ul>
            {myOverdue.length > 0 && <p className="mt-2 text-sm text-danger">{myOverdue.length} overdue task(s).</p>}
          </section>
        </>
      )}

      {role === "mentor" && (
        <section className={card}>
          <h3 className={sectionTitle}>Weekly reports waiting for review</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {state.weeklyReports
              .filter((r) => r.status === "SUBMITTED" || r.status === "RESUBMITTED")
              .map((r) => (
                <li key={r.id}>
                  {r.reportingPeriod} <span className={meta}>· round {r.round}</span>
                </li>
              ))}
            {state.weeklyReports.filter((r) => r.status === "SUBMITTED" || r.status === "RESUBMITTED").length === 0 && (
              <li className={meta}>Nothing waiting.</li>
            )}
          </ul>
        </section>
      )}

      {role === "manager" && (
        <section className={card}>
          <h3 className={sectionTitle}>Approved reports</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {state.weeklyReports
              .filter((r) => r.status === "APPROVED")
              .slice(0, 5)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  {r.reportingPeriod} {r.overriddenBy && <WarnBadge>override</WarnBadge>}
                </li>
              ))}
            {state.weeklyReports.filter((r) => r.status === "APPROVED").length === 0 && (
              <li className={meta}>None approved yet.</li>
            )}
          </ul>
        </section>
      )}

      <section className={card}>
        <h3 className={sectionTitle}>Blockers ({openBlockers.length})</h3>
        {openBlockers.length === 0 && <p className={cn(meta, "mt-2")}>Nothing blocking right now.</p>}
        <ul className="mt-2 space-y-1.5 text-sm">
          {openBlockers.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" /> {b.description}
              <span className={meta}>· {timeAgo(b.createdAt)}</span>
              {role !== "intern" && !b.mentorResponded && b.status !== "RESOLVED" && <WarnBadge>no mentor response</WarnBadge>}
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h3 className={sectionTitle}>
          {role === "intern" ? "My tasks" : "Active tasks"} ({activeTasks.length})
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {(role === "intern" ? myTasks.filter((t) => t.status !== "DONE") : activeTasks).slice(0, 8).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-1.5">
              <TaskStatusBadge status={t.status} /> {t.title}
              {t.dueDate && t.dueDate < Date.now() && t.status !== "DONE" && <WarnBadge>overdue</WarnBadge>}
            </li>
          ))}
          {activeTasks.length === 0 && <li className={meta}>No active tasks.</li>}
        </ul>
      </section>

      <section className={card}>
        <h3 className={sectionTitle}>{role === "intern" ? "Mentor feedback" : "Recent feedback"}</h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {recentFeedback.map((f) => (
            <li key={f.id}>
              <strong>{f.authorName}:</strong> {f.content}
              <span className={meta}> · {timeAgo(f.createdAt)}</span>
            </li>
          ))}
          {recentFeedback.length === 0 && <li className={meta}>No feedback yet.</li>}
        </ul>
      </section>

      <section className={cn(card, "md:col-span-2")}>
        <h3 className={sectionTitle}>Update history</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {state.updates.slice(0, 10).map((u) => (
            <li key={u.id}>
              <div>
                <span className="font-medium">{u.type}</span> <strong>{u.authorName}</strong>
                <span className={meta}> · {timeAgo(u.createdAt)}</span>
              </div>
              <div>{u.content}</div>
            </li>
          ))}
          {state.updates.length === 0 && <li className={meta}>No updates yet.</li>}
        </ul>
      </section>
    </div>
  );
}
