import type { MeUser, Membership } from "../auth/types";
import { usePortfolio } from "../lib/usePortfolio";
import { workspaceHash, navigate } from "../router";
import { btn, card, cardInteractive, cn, meta, pageTitle, sectionTitle } from "../ui/primitives";
import { WeeklyStatusBadge } from "../ui/badges";
import { LoadingScreen, EmptyState, StatTile } from "../ui/states";
import { AttentionList } from "./AttentionList";
import { byReasons, flattenAttention } from "./attentionGroups";

export function ManagerHome({ user, memberships }: { user: MeUser; memberships: Membership[] }) {
  void user;
  const managerMemberships = memberships.filter((m) => m.role === "manager");
  const { entries, loading } = usePortfolio(managerMemberships, { kind: "production" });

  if (loading) return <LoadingScreen label="Loading your portfolio…" />;
  if (managerMemberships.length === 0) {
    return (
      <EmptyState
        title="No workspaces in your portfolio yet"
        description="Create a new internship/project workspace to get started."
        action={
          <button className={cn(btn("primary"), "mt-2")} onClick={() => navigate("#/workspaces/new")}>
            Set up a new workspace
          </button>
        }
      />
    );
  }

  const attention = flattenAttention(entries);
  const escalations = byReasons(attention, ["ESCALATION"]);
  const longRunningBlockers = byReasons(attention, ["BLOCKER_UNRESOLVED_TOO_LONG", "URGENT_TASK_STILL_BLOCKED"]);
  const stuckReviews = byReasons(attention, ["MENTOR_REVIEW_OVERDUE", "REPORT_WAITING_TOO_LONG"]);
  const mentions = byReasons(attention, ["MENTIONED"]);

  const approved = entries.flatMap((e) =>
    (e.snapshot?.weeklyReports ?? [])
      .filter((r) => r.status === "APPROVED")
      .map((r) => ({ report: r, workspaceName: e.membership.workspaceName, workspaceId: e.membership.workspaceId })),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={pageTitle}>Where does the team need intervention?</h1>
        <button className={btn("primary")} onClick={() => navigate("#/workspaces/new")}>
          + New workspace
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Workspaces" value={managerMemberships.length} />
        <StatTile label="Escalations" value={escalations.length} tone={escalations.length > 0 ? "danger" : "neutral"} />
        <StatTile label="Long-running blockers" value={longRunningBlockers.length} tone={longRunningBlockers.length > 0 ? "warning" : "neutral"} />
        <StatTile label="Stuck reviews" value={stuckReviews.length} tone={stuckReviews.length > 0 ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AttentionList title="Escalations" rows={escalations} emptyText="No open escalations." />
        <AttentionList title="Long-running blockers" rows={longRunningBlockers} emptyText="No long-running blockers." />
        <AttentionList title="Stuck weekly reviews" rows={stuckReviews} emptyText="Nothing stuck in review." />
        {mentions.length > 0 && <AttentionList title="Mentions" rows={mentions} emptyText="" />}
      </div>

      <section className={cn(card, "flex flex-col gap-3")}>
        <h2 className={sectionTitle}>Portfolio</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map(({ membership, snapshot, error }) => {
            const activeTasks = snapshot?.tasks.filter((t) => t.status !== "DONE").length ?? 0;
            const openBlockers = snapshot?.blockers.filter((b) => b.status !== "RESOLVED").length ?? 0;
            return (
              <li key={membership.workspaceId}>
                <a href={workspaceHash(membership.workspaceId)} className={cn(cardInteractive, "block")}>
                  <div className="font-medium text-text">{membership.workspaceName}</div>
                  {error ? (
                    <p className="text-sm text-danger">{error}</p>
                  ) : (
                    <p className={meta}>
                      {activeTasks} active task(s) · {openBlockers} open blocker(s)
                    </p>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {approved.length > 0 && (
        <section className={cn(card, "flex flex-col gap-3")}>
          <h2 className={sectionTitle}>Recently approved reports</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {approved.slice(0, 8).map(({ report, workspaceName, workspaceId }) => (
              <li key={report.id} className="flex items-center gap-2">
                <WeeklyStatusBadge status={report.status} />
                <a href={workspaceHash(workspaceId, "weekly")} className="hover:underline">
                  {workspaceName} — {report.reportingPeriod}
                </a>
                {report.overriddenBy && <span className={meta}>(manager override)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
