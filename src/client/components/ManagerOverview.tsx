import { useEffect, useState } from "react";
import type { OverviewResponse, OverviewRow, Role } from "../../shared/protocol";
import { timeAgo } from "../lib/format";

interface PersonDraft {
  displayName: string;
  email: string;
}

function emptyPerson(): PersonDraft {
  return { displayName: "", email: "" };
}

function NewWorkspaceForm({
  identity,
  devRole,
  onCreated,
}: {
  identity: { userId: string; displayName: string };
  devRole: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [intern, setIntern] = useState<PersonDraft>(emptyPerson());
  const [mentor, setMentor] = useState<PersonDraft>(emptyPerson());
  const [manager, setManager] = useState<PersonDraft>(emptyPerson());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim() && intern.displayName && intern.email && mentor.displayName && mentor.email && manager.displayName && manager.email;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        userId: identity.userId,
        displayName: identity.displayName,
        devRole,
      });
      const res = await fetch(`/api/demo/workspaces?${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), intern, mentor, manager }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setOpen(false);
      setName("");
      setIntern(emptyPerson());
      setMentor(emptyPerson());
      setManager(emptyPerson());
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)}>
        + New workspace
      </button>
    );
  }

  return (
    <div className="card new-workspace-form">
      <h3>New workspace</h3>
      {error && <div className="banner error">{error}</div>}
      <label>Project / workspace name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Data Pipeline" />
      {(["intern", "mentor", "manager"] as const).map((role) => {
        const draft = role === "intern" ? intern : role === "mentor" ? mentor : manager;
        const setDraft = role === "intern" ? setIntern : role === "mentor" ? setMentor : setManager;
        return (
          <div className="row" key={role}>
            <div>
              <label>{role[0].toUpperCase() + role.slice(1)} name</label>
              <input
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </div>
            <div>
              <label>{role[0].toUpperCase() + role.slice(1)} email</label>
              <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
          </div>
        );
      })}
      <div className="row editor-actions">
        <button className="primary" disabled={!ready || busy} onClick={submit}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function ManagerOverview({
  identity,
  devRole,
  onOpenWorkspace,
}: {
  identity: { userId: string; displayName: string };
  devRole: string;
  onOpenWorkspace: (id: string) => void;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canCreateWorkspace: Role | string = devRole;

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/demo/overview?userId=${encodeURIComponent(identity.userId)}`)
      .then((r) => r.json() as Promise<OverviewResponse>)
      .then((d) => live && setData(d))
      .catch(() => live && setError("Failed to load overview"));
    return () => {
      live = false;
    };
  }, [identity.userId, refreshKey]);

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
        {(canCreateWorkspace === "mentor" || canCreateWorkspace === "manager") && (
          <NewWorkspaceForm identity={identity} devRole={devRole} onCreated={() => setRefreshKey((k) => k + 1)} />
        )}
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
