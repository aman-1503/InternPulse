import type { MeUser, Membership } from "../auth/types";
import { usePortfolio } from "../lib/usePortfolio";
import { timeAgo } from "../lib/format";
import { workspaceHash } from "../router";
import { card, cn, meta, sectionTitle, btn } from "../ui/primitives";
import { PriorityBadge } from "../ui/badges";
import { LoadingScreen, EmptyState } from "../ui/states";
import { flattenAttention, byReasons, REASON_LABEL } from "./attentionGroups";

export function InternHome({ user, memberships }: { user: MeUser; memberships: Membership[] }) {
  const internMemberships = memberships.filter((m) => m.role === "intern");
  const { entries, loading } = usePortfolio(internMemberships, { kind: "production" });

  if (loading) return <LoadingScreen label="Loading your work…" />;

  if (internMemberships.length === 0) {
    return <EmptyState title="No internship workspace yet" description="You'll see it here once you accept an invitation." />;
  }

  const attention = flattenAttention(entries);
  const workspace = entries[0]; // one long-lived workspace per intern, per product model
  const snapshot = workspace?.snapshot ?? null;

  const now = Date.now();
  const myTasks = snapshot ? snapshot.tasks.filter((t) => t.assigneeId === user.id || (!t.assigneeId && t.createdBy === user.id)) : [];
  const urgent = myTasks.filter((t) => t.status !== "DONE" && (t.priority === "URGENT" || t.priority === "HIGH"));
  const overdue = myTasks.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate < now);
  const dueSoon = myTasks.filter(
    (t) => t.status !== "DONE" && t.dueDate && t.dueDate >= now && t.dueDate - now < 3 * 86_400_000,
  );
  const openBlockers = snapshot?.blockers.filter((b) => b.status !== "RESOLVED") ?? [];
  const resolutionRequested = openBlockers.filter((b) => b.status === "RESOLUTION_REQUESTED");
  const feedback = snapshot?.feedback.slice(0, 3) ?? [];
  const weekly = snapshot ? [...snapshot.weeklyReports].sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  const mentions = snapshot?.mentions.filter((m) => !m.readAt) ?? [];

  const changesRequested = byReasons(attention, ["REVIEW_CHANGES_REQUESTED", "BLOCKER_RESOLUTION_REJECTED"]);
  const nextActions = attention.slice(0, 5);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Welcome back, {user.displayName.split(" ")[0]}</h1>
        {workspace && (
          <p className={meta}>
            <a href={workspaceHash(workspace.membership.workspaceId)} className="text-accent hover:underline">
              {workspace.membership.workspaceName}
            </a>
          </p>
        )}
      </div>

      {changesRequested.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-sm text-warning">
          {REASON_LABEL.REVIEW_CHANGES_REQUESTED} — check your weekly review.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cn(card, "flex flex-col gap-2")}>
          <h2 className={sectionTitle}>Next actions</h2>
          {nextActions.length === 0 ? (
            <p className={meta}>Nothing outstanding — keep the updates coming.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {nextActions.map((a) => (
                <li key={a.item.id}>
                  <a href={workspaceHash(a.workspaceId, a.item.navigate.tab)} className="hover:underline">
                    → {a.item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {workspace && (
            <a href={workspaceHash(workspace.membership.workspaceId, "agent")} className={cn(btn("default"), "mt-1 self-start")}>
              Ask the Progress Agent
            </a>
          )}
        </section>

        <section className={cn(card, "flex flex-col gap-2")}>
          <h2 className={sectionTitle}>Urgent &amp; overdue</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {urgent.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <PriorityBadge priority={t.priority} />
                <span>{t.title}</span>
              </li>
            ))}
            {urgent.length === 0 && <li className={meta}>No urgent/high tasks right now.</li>}
          </ul>
          {overdue.length > 0 && <p className="text-sm text-danger">{overdue.length} task(s) overdue.</p>}
          {dueSoon.length > 0 && <p className={meta}>{dueSoon.length} due in the next 3 days.</p>}
        </section>

        <section className={cn(card, "flex flex-col gap-2")}>
          <h2 className={sectionTitle}>Blockers</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {openBlockers.slice(0, 5).map((b) => (
              <li key={b.id}>{b.description}</li>
            ))}
            {openBlockers.length === 0 && <li className={meta}>Nothing blocking you right now.</li>}
          </ul>
          {resolutionRequested.length > 0 && (
            <p className={meta}>{resolutionRequested.length} awaiting mentor/manager confirmation.</p>
          )}
        </section>

        <section className={cn(card, "flex flex-col gap-2")}>
          <h2 className={sectionTitle}>Mentor feedback</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {feedback.map((f) => (
              <li key={f.id}>
                <strong>{f.authorName}:</strong> {f.content}
                <span className={meta}> · {timeAgo(f.createdAt)}</span>
              </li>
            ))}
            {feedback.length === 0 && <li className={meta}>No feedback yet.</li>}
          </ul>
        </section>

        {mentions.length > 0 && (
          <section className={cn(card, "flex flex-col gap-2 md:col-span-2")}>
            <h2 className={sectionTitle}>Mentions</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {mentions.map((m) => (
                <li key={m.id}>
                  <strong>{m.mentionedByName}</strong> mentioned you: “{m.snippet}”
                  <span className={meta}> · {timeAgo(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={cn(card, "flex flex-col gap-2 md:col-span-2")}>
          <h2 className={sectionTitle}>Weekly review status</h2>
          {weekly ? (
            <p className="text-sm">
              {weekly.reportingPeriod} — <span className="font-medium">{weekly.status.replace(/_/g, " ")}</span>
            </p>
          ) : (
            <p className={meta}>No weekly report started yet.</p>
          )}
          {workspace && (
            <a href={workspaceHash(workspace.membership.workspaceId, "weekly")} className={cn(btn("default"), "self-start")}>
              Open weekly review
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
