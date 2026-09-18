import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { PendingInvitation } from "../auth/types";
import { acceptInvitation } from "../lib/api";
import { navigate, workspaceHash } from "../router";
import { timeUntil } from "../lib/format";
import { btn, card, cn, meta } from "../ui/primitives";
import { RoleBadge } from "../ui/badges";
import { Banner } from "../ui/states";
import { invitationErrorMessage } from "./inviteErrors";

export function InvitationsScreen({ invitations }: { invitations: PendingInvitation[] }) {
  const { refresh } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const accept = async (inv: PendingInvitation) => {
    setBusyId(inv.id);
    setErrors((e) => ({ ...e, [inv.id]: "" }));
    try {
      await acceptInvitation(inv.id);
      refresh();
      navigate(workspaceHash(inv.workspaceId));
    } catch (err) {
      setErrors((e) => ({ ...e, [inv.id]: invitationErrorMessage(err) }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-text">You've been invited</h1>
        <p className={meta}>Accept an invitation to join its workspace.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {invitations.map((inv) => (
          <li key={inv.id} className={cn(card, "flex flex-col gap-2")}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{inv.workspaceName}</span>
              <RoleBadge role={inv.role} />
            </div>
            <p className={meta}>
              Invited by {inv.invitedByName} · expires {timeUntil(inv.expiresAt)}
            </p>
            {errors[inv.id] && <Banner tone="danger">{errors[inv.id]}</Banner>}
            <button className={cn(btn("primary"), "self-start")} disabled={busyId === inv.id} onClick={() => accept(inv)}>
              {busyId === inv.id ? "Accepting…" : "Accept"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
