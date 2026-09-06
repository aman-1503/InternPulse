import { useEffect, useState } from "react";
import type { OverviewResponse, OverviewRow } from "../../shared/protocol";
import { timeAgo } from "../lib/format";

export function ManagerOverview({
  identity,
  onOpenWorkspace,
}: {
  identity: { userId: string };
  onOpenWorkspace: (id: string) => void;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/overview?userId=${encodeURIComponent(identity.userId)}`)
      .then((r) => r.json() as Promise<OverviewResponse>)
      .then((d) => live && setData(d))
      .catch(() => live && setError("Failed to load overview"));
    return () => {
      live = false;
    };
  }, [identity.userId]);

  return (
    <div className="overview">
      <div className="workspace-head">
        <div>
          <h2>Manager overview</h2>
          <p className="meta">
            Workspaces roll up live counts pulled from each workspace's Durable Object — no
            workspace data is copied into D1.
          </p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {data?.demoFallback && (
        <div className="banner">
          Showing all workspaces (current demo identity has no manager membership).
        </div>
      )}
      {!data && !error && <p className="meta">Loading…</p>}

      <div className="card-grid">
        {data?.workspaces.map((w) => (
          <WorkspaceCard key={w.id} row={w} onOpen={() => onOpenWorkspace(w.id)} />
        ))}
        {data && data.workspaces.length === 0 && (
          <p className="meta">
            No workspaces. Run <code>npm run db:seed:local</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({ row, onOpen }: { row: OverviewRow; onOpen: () => void }) {
  return (
    <button className="card ws-card" onClick={onOpen}>
      <div className="ws-card-head">
        <strong>{row.name}</strong>
        <span className="meta">{row.slug}</span>
      </div>
      <div className="ws-card-stats">
        <span>
          <b>{row.activeTasks}</b> active tasks
        </span>
        <span className={row.openBlockers > 0 ? "danger" : ""}>
          <b>{row.openBlockers}</b> open blockers
        </span>
      </div>
      <div className="meta">Intern: {row.intern ? row.intern.displayName : "—"}</div>
      <div className="ws-card-update">
        {row.latestUpdate ? (
          <>
            “{row.latestUpdate.content}”
            <span className="meta">
              {" "}
              — {row.latestUpdate.authorName}, {timeAgo(row.latestUpdate.createdAt)}
            </span>
          </>
        ) : (
          <span className="meta">No updates yet</span>
        )}
      </div>
      <div className="ws-card-open">Open workspace →</div>
    </button>
  );
}
