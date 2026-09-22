import { useEffect, useState } from "react";
import {
  ApiError,
  adminListAudit,
  adminListInvitations,
  adminListMembers,
  adminListUsers,
  adminListWorkspaces,
  adminRemoveMembership,
  adminRepairMembership,
  adminRevokeInvitation,
  adminSetUserStatus,
  getHealth,
  type AdminMemberRow,
  type AdminUserRow,
  type AdminWorkspaceRow,
  type AuditEventRow,
  type HealthResponse,
  type WorkspaceInvitation,
} from "../lib/api";
import { timeAgo } from "../lib/format";
import { badge, badgeTones, btn, card, cardInteractive, cn, input, meta, pageTitle, sectionTitle, select } from "../ui/primitives";
import { RoleBadge } from "../ui/badges";
import { ShieldIcon } from "../ui/icons";
import { Banner, ConfirmDialog, LoadingScreen } from "../ui/states";

type AdminTab = "users" | "workspaces" | "invitations" | "audit" | "health";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("users");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="h-5 w-5 text-role-admin" />
        <h1 className={pageTitle}>Admin</h1>
      </div>
      <nav className="tabs-scroll flex gap-1 border-b border-border" role="tablist">
        {(["users", "workspaces", "invitations", "audit", "health"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors",
              tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:border-border hover:text-text",
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "users" && <UsersPanel />}
      {tab === "workspaces" && <WorkspacesPanel />}
      {tab === "invitations" && <InvitationsPanel />}
      {tab === "audit" && <AuditPanel />}
      {tab === "health" && <HealthPanel />}
    </div>
  );
}

function useAdminList<T>(loader: () => Promise<T[]>, deps: unknown[] = []) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    setItems(null);
    setError(null);
    loader()
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load."));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { items, error, reload };
}

function UsersPanel() {
  const { items, error, reload } = useAdminList(() => adminListUsers().then((r) => r.users));
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUserRow; action: "suspend" | "activate" | "disable" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminSetUserStatus(confirmTarget.user.id, confirmTarget.action);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setBusy(false);
      setConfirmTarget(null);
    }
  };

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!items) return <LoadingScreen label="Loading users…" />;

  return (
    <div className="flex flex-col gap-3">
      {actionError && <Banner tone="danger">{actionError}</Banner>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Platform role</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-t border-border transition-colors hover:bg-surface-muted/50">
                <td className="px-3 py-2">{u.displayName}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">
                  <span className={badge(u.accountStatus === "ACTIVE" ? badgeTones.success : badgeTones.danger)}>{u.accountStatus}</span>
                </td>
                <td className="px-3 py-2">{u.platformRole}</td>
                <td className="px-3 py-2">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</td>
                <td className="px-3 py-2 text-right">
                  {u.accountStatus === "ACTIVE" ? (
                    <button className={btn("danger")} onClick={() => setConfirmTarget({ user: u, action: "suspend" })}>
                      Suspend
                    </button>
                  ) : (
                    <button className={btn("default")} onClick={() => setConfirmTarget({ user: u, action: "activate" })}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.action === "suspend" ? "Suspend this user?" : "Reactivate this user?"}
        description={confirmTarget ? `${confirmTarget.user.displayName} (${confirmTarget.user.email})` : undefined}
        confirmLabel={confirmTarget?.action === "suspend" ? "Suspend" : "Reactivate"}
        danger={confirmTarget?.action === "suspend"}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

function WorkspacesPanel() {
  const { items, error } = useAdminList(() => adminListWorkspaces().then((r) => r.workspaces));
  const [selected, setSelected] = useState<AdminWorkspaceRow | null>(null);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!items) return <LoadingScreen label="Loading workspaces…" />;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((w) => (
          <li key={w.id}>
            <button className={cn(cardInteractive, "flex w-full items-center justify-between gap-2 text-left")} onClick={() => setSelected(w)}>
              <span>
                {w.name} {w.isDemo === 1 && <span className={meta}>(demo)</span>}
              </span>
              <span className={meta}>{w.memberCount} member(s)</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && <WorkspaceMembersPanel workspace={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function WorkspaceMembersPanel({ workspace, onClose }: { workspace: AdminWorkspaceRow; onClose: () => void }) {
  const { items, error, reload } = useAdminList(() => adminListMembers(workspace.id).then((r) => r.members), [workspace.id]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"intern" | "mentor" | "manager">("intern");
  const [actionError, setActionError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminMemberRow | null>(null);
  const [busy, setBusy] = useState(false);

  const repair = async () => {
    if (!userId.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminRepairMembership(workspace.id, { userId: userId.trim(), role });
      setUserId("");
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminRemoveMembership(workspace.id, removeTarget.userId);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Failed — the backend may be enforcing the last-manager guard.");
    } finally {
      setBusy(false);
      setRemoveTarget(null);
    }
  };

  return (
    <section className={cn(card, "flex flex-col gap-3")}>
      <div className="flex items-center justify-between">
        <h3 className={sectionTitle}>{workspace.name} — members</h3>
        <button className={btn("ghost")} onClick={onClose}>
          Close
        </button>
      </div>
      {actionError && <Banner tone="danger">{actionError}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      {!items ? (
        <LoadingScreen label="Loading members…" />
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2">
              <span>
                {m.displayName} <span className={meta}>({m.email})</span>
              </span>
              <span className="flex items-center gap-2">
                <RoleBadge role={m.role} />
                <button className={btn("danger")} onClick={() => setRemoveTarget(m)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className={meta}>Repair/add membership (by user id):</span>
        <input className={cn(input, "w-64")} placeholder="user id" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <select className={select} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="intern">intern</option>
          <option value="mentor">mentor</option>
          <option value="manager">manager</option>
        </select>
        <button className={btn("default")} disabled={busy || !userId.trim()} onClick={repair}>
          Apply
        </button>
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this member?"
        description={removeTarget ? `${removeTarget.displayName} will lose access to ${workspace.name}.` : undefined}
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  );
}

function InvitationsPanel() {
  const { items, error, reload } = useAdminList(() => adminListInvitations().then((r) => r.invitations));
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await adminRevokeInvitation(revokeTarget.id, revokeTarget.workspaceId);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Failed to revoke.");
    } finally {
      setBusy(false);
      setRevokeTarget(null);
    }
  };

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!items) return <LoadingScreen label="Loading invitations…" />;

  return (
    <div className="flex flex-col gap-3">
      {actionError && <Banner tone="danger">{actionError}</Banner>}
      <ul className="flex flex-col gap-2">
        {items.map((inv) => (
          <li key={inv.id} className={cn(card, "flex items-center justify-between gap-2")}>
            <span>
              {inv.email} <RoleBadge role={inv.role as never} /> <span className={meta}>· {inv.status}</span>
            </span>
            {inv.status === "PENDING" && (
              <button className={btn("danger")} onClick={() => setRevokeTarget(inv)}>
                Revoke
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className={meta}>No invitations.</li>}
      </ul>
      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke this invitation?"
        description={revokeTarget?.email}
        confirmLabel="Revoke"
        danger
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}

function AuditPanel() {
  const { items, error } = useAdminList(() => adminListAudit().then((r) => r.events));
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!items) return <LoadingScreen label="Loading audit log…" />;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((e: AuditEventRow) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-border py-1.5">
          <span className={meta}>{timeAgo(e.created_at)}</span>
          <span className="font-medium">{e.action}</span>
          {e.target_type && (
            <span className={meta}>
              on {e.target_type} {e.target_id}
            </span>
          )}
        </li>
      ))}
      {items.length === 0 && <li className={meta}>No audit events yet.</li>}
    </ul>
  );
}

function HealthPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setError("Failed to load health."));
  }, []);
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!health) return <LoadingScreen label="Checking system health…" />;
  return (
    <section className={cn(card, "flex flex-col gap-1")}>
      <p>
        Service: <strong>{health.service}</strong>
      </p>
      <p>
        D1: <span className={badge(health.d1 === "ok" ? badgeTones.success : badgeTones.danger)}>{health.d1}</span>
      </p>
      <p className={meta}>Checked {timeAgo(health.time)}</p>
    </section>
  );
}
