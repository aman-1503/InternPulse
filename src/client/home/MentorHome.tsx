import type { MeUser, Membership } from "../auth/types";
import { usePortfolio } from "../lib/usePortfolio";
import { workspaceHash } from "../router";
import { card, cn, meta, sectionTitle } from "../ui/primitives";
import { LoadingScreen, EmptyState } from "../ui/states";
import { AttentionList } from "./AttentionList";
import { byReasons, flattenAttention } from "./attentionGroups";

const LONG_RUNNING_MS = 24 * 60 * 60 * 1000;

export function MentorHome({ user, memberships }: { user: MeUser; memberships: Membership[] }) {
  void user;
  const mentorMemberships = memberships.filter((m) => m.role === "mentor");
  const { entries, loading } = usePortfolio(mentorMemberships, { kind: "production" });

  if (loading) return <LoadingScreen label="Loading your interns…" />;
  if (mentorMemberships.length === 0) {
    return <EmptyState title="You're not mentoring any workspace yet" description="Workspaces you mentor will appear here." />;
  }

  const attention = flattenAttention(entries);
  const waitingOnYou = byReasons(attention, ["BLOCKER_WAITING_ON_YOU", "BLOCKER_NO_MENTOR_RESPONSE"]);
  const reportsForReview = byReasons(attention, ["REPORT_READY_FOR_REVIEW"]);
  const urgentGuidance = byReasons(attention, ["URGENT_TASK_NEEDS_GUIDANCE"]);
  const staleInterns = byReasons(attention, ["INTERN_STALE"]);
  const mentions = byReasons(attention, ["MENTIONED"]);

  const now = Date.now();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-text">Which interns need your attention?</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <AttentionList
          title="Blockers waiting on you"
          rows={waitingOnYou}
          emptyText="No blockers need your response right now."
        />
        <AttentionList title="Weekly reports awaiting review" rows={reportsForReview} emptyText="Nothing waiting for review." />
        <AttentionList title="Urgent tasks needing guidance" rows={urgentGuidance} emptyText="No urgent tasks need guidance." />
        <AttentionList title="Stale progress" rows={staleInterns} emptyText="No workspaces have gone quiet." />
        {mentions.length > 0 && <AttentionList title="Mentions" rows={mentions} emptyText="" />}
      </div>

      <section className={cn(card, "flex flex-col gap-3")}>
        <h2 className={sectionTitle}>Your workspaces</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map(({ membership, snapshot, error }) => {
            const openBlockers = snapshot?.blockers.filter((b) => b.status !== "RESOLVED") ?? [];
            const longRunning = openBlockers.filter((b) => now - b.createdAt > LONG_RUNNING_MS);
            return (
              <li key={membership.workspaceId}>
                <a
                  href={workspaceHash(membership.workspaceId)}
                  className="block rounded-lg border border-border p-3 hover:border-accent hover:bg-accent-muted/40"
                >
                  <div className="font-medium text-text">{membership.workspaceName}</div>
                  {error ? (
                    <p className="text-sm text-danger">{error}</p>
                  ) : (
                    <p className={meta}>
                      {openBlockers.length} open blocker(s){longRunning.length > 0 && ` · ${longRunning.length} long-running`}
                    </p>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
