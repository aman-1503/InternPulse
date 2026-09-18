import type { Membership } from "../auth/types";
import { usePortfolio } from "../lib/usePortfolio";
import { workspaceHash } from "../router";
import { card, cn, meta, sectionTitle } from "../ui/primitives";
import { WeeklyStatusBadge } from "../ui/badges";
import { EmptyState, LoadingScreen } from "../ui/states";

export function WeeklyReviewsPage({ memberships }: { memberships: Membership[] }) {
  const { entries, loading } = usePortfolio(memberships, { kind: "production" });
  if (loading) return <LoadingScreen label="Loading weekly reviews…" />;

  const rows = entries.flatMap((e) =>
    (e.snapshot?.weeklyReports ?? []).map((r) => ({
      report: r,
      workspaceId: e.membership.workspaceId,
      workspaceName: e.membership.workspaceName,
      role: e.membership.role,
    })),
  );
  rows.sort((a, b) => b.report.createdAt - a.report.createdAt);

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-text">Weekly reviews</h1>
      {rows.length === 0 ? (
        <EmptyState title="No weekly reports yet" description="They'll show up here once someone starts one." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ report, workspaceId, workspaceName }) => (
            <li key={report.id}>
              <a href={workspaceHash(workspaceId, "weekly")} className={cn(card, "flex items-center justify-between gap-2 hover:border-accent")}>
                <div>
                  <p className={sectionTitle}>{workspaceName}</p>
                  <p className={meta}>
                    {report.reportingPeriod} · round {report.round}
                  </p>
                </div>
                <WeeklyStatusBadge status={report.status} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
