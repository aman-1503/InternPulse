import { useEffect, useState } from "react";
import type { OverviewResponse, OverviewRow, Role } from "../../shared/protocol";
import { timeAgo } from "../lib/format";
import { btn, card, cn, input, meta, row } from "../ui/primitives";
import { Banner } from "../ui/states";

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
      const qs = new URLSearchParams({ userId: identity.userId, displayName: identity.displayName, devRole });
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
      <button className={btn("primary")} onClick={() => setOpen(true)}>
        + New workspace
      </button>
    );
  }

  return (
    <div className={cn(card, "flex flex-col gap-2")}>
      <h3 className="text-sm font-semibold text-text">New workspace</h3>
      {error && <Banner tone="danger">{error}</Banner>}
      <label className="text-sm font-medium">Project / workspace name</label>
      <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Data Pipeline" />
      {(["intern", "mentor", "manager"] as const).map((role) => {
        const draft = role === "intern" ? intern : role === "mentor" ? mentor : manager;
        const setDraft = role === "intern" ? setIntern : role === "mentor" ? setMentor : setManager;
        return (
          <div className={row} key={role}>
            <div className="flex-1">
              <label className="text-sm font-medium">{role[0].toUpperCase() + role.slice(1)} name</label>
              <input className={input} value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">{role[0].toUpperCase() + role.slice(1)} email</label>
              <input className={input} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
          </div>
        );
      })}
      <div className={row}>
        <button className={btn("primary")} disabled={!ready || busy} onClick={submit}>
          {busy ? "Creating…" : "Create workspace"}
        </button>
        <button className={btn("default")} onClick={() => setOpen(false)}>
          Cancel
        </button>
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
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Manager overview</h2>
          <p className={meta}>Workspaces roll up live counts pulled from each workspace's Durable Object.</p>
        </div>
        {(canCreateWorkspace === "mentor" || canCreateWorkspace === "manager") && (
          <NewWorkspaceForm identity={identity} devRole={devRole} onCreated={() => setRefreshKey((k) => k + 1)} />
        )}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {data?.demoFallback && <Banner>Showing all workspaces (current demo identity has no manager membership).</Banner>}
      {!data && !error && <p className={meta}>Loading…</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.workspaces.map((w) => (
          <WorkspaceCard key={w.id} row={w} onOpen={() => onOpenWorkspace(w.id)} />
        ))}
        {data && data.workspaces.length === 0 && (
          <p className={meta}>
            No workspaces. Run <code>npm run db:seed:local</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({ row, onOpen }: { row: OverviewRow; onOpen: () => void }) {
  return (
    <button className={cn(card, "flex flex-col gap-1.5 text-left hover:border-accent")} onClick={onOpen}>
      <div className="flex items-baseline justify-between">
        <strong className="text-text">{row.name}</strong>
        <span className={meta}>{row.slug}</span>
      </div>
      <div className="flex gap-3 text-sm">
        <span>
          <b>{row.activeTasks}</b> active tasks
        </span>
        <span className={row.openBlockers > 0 ? "text-danger" : ""}>
          <b>{row.openBlockers}</b> open blockers
        </span>
      </div>
      <div className={meta}>Intern: {row.intern ? row.intern.displayName : "—"}</div>
      <div className="text-sm">
        {row.latestUpdate ? (
          <>
            "{row.latestUpdate.content}"
            <span className={meta}>
              {" "}
              — {row.latestUpdate.authorName}, {timeAgo(row.latestUpdate.createdAt)}
            </span>
          </>
        ) : (
          <span className={meta}>No updates yet</span>
        )}
      </div>
      <div className="text-sm font-medium text-accent">Open workspace →</div>
    </button>
  );
}
