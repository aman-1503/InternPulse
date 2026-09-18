import { useEffect, useState } from "react";
import type { Role, WorkspaceMember } from "../../shared/protocol";
import {
  ApiError,
  inviteToWorkspace,
  listWorkspaceInvitations,
  revokeWorkspaceInvitation,
  type WorkspaceInvitation,
} from "../lib/api";
import { timeAgo } from "../lib/format";
import { btn, card, cn, input, meta, row, sectionTitle, select, stack } from "../ui/primitives";
import { RoleBadge } from "../ui/badges";
import { Banner, ConfirmDialog } from "../ui/states";

export function WorkspaceSettings({
  workspaceId,
  workspaceName,
  members,
  canManage,
}: {
  workspaceId: string;
  workspaceName: string;
  members: WorkspaceMember[];
  /** true for mentor/manager of THIS workspace — invite/revoke ability. */
  canManage: boolean;
}) {
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(canManage);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("intern");
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceInvitation | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    listWorkspaceInvitations(workspaceId)
      .then((r) => live && setInvitations(r.invitations))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Failed to load invitations."))
      .finally(() => live && setLoadingInvites(false));
    return () => {
      live = false;
    };
  }, [workspaceId, canManage]);

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { invitation } = await inviteToWorkspace(workspaceId, { email: email.trim(), role });
      setInvitations((prev) => [invitation, ...prev.filter((i) => i.id !== invitation.id)]);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send invitation.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      const { invitation } = await revokeWorkspaceInvitation(workspaceId, revokeTarget.id);
      setInvitations((prev) => prev.map((i) => (i.id === invitation.id ? invitation : i)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke invitation.");
    } finally {
      setBusy(false);
      setRevokeTarget(null);
    }
  };

  const pending = invitations.filter((i) => i.status === "PENDING");

  return (
    <div className="flex flex-col gap-4">
      <section className={cn(card, stack)}>
        <h2 className={sectionTitle}>Workspace</h2>
        <p className="text-sm text-text">{workspaceName}</p>
        <p className={meta}>ID: {workspaceId}</p>
      </section>

      {error && <Banner tone="danger">{error}</Banner>}

      <section className={cn(card, stack)}>
        <h2 className={sectionTitle}>Members</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2">
              <span>{m.displayName}</span>
              <RoleBadge role={m.role} />
            </li>
          ))}
          {members.length === 0 && <li className={meta}>No members yet.</li>}
        </ul>
        {!canManage && (
          <p className={meta}>Only a mentor or manager of this workspace can invite members or manage invitations.</p>
        )}
      </section>

      {canManage && (
        <section className={cn(card, stack)}>
          <h2 className={sectionTitle}>Invite a member</h2>
          <p className={meta}>They must sign in with this exact email to accept.</p>
          <div className={row}>
            <input
              className={cn(input, "flex-1")}
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className={select} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="intern">intern</option>
              <option value="mentor">mentor</option>
              <option value="manager">manager</option>
            </select>
            <button className={btn("primary")} disabled={!email.trim() || busy} onClick={invite}>
              Invite
            </button>
          </div>

          <h3 className="mt-2 text-sm font-medium text-text">Pending invitations</h3>
          {loadingInvites ? (
            <p className={meta}>Loading…</p>
          ) : pending.length === 0 ? (
            <p className={meta}>No pending invitations.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span>
                    {inv.email} <RoleBadge role={inv.role as Role} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={meta}>expires {timeAgo(inv.expiresAt)}</span>
                    <button className={btn("ghost")} onClick={() => setRevokeTarget(inv)}>
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke this invitation?"
        description={revokeTarget ? `${revokeTarget.email} will no longer be able to accept this invite.` : undefined}
        confirmLabel="Revoke"
        danger
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
