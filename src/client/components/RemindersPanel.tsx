import { useState } from "react";
import type { Reminder } from "../../shared/protocol";
import { timeAgo } from "../lib/format";
import { acknowledgeReminder } from "../lib/phase4b";

interface Identity {
  userId: string;
  displayName: string;
}

const LABEL: Record<Reminder["type"], string> = {
  BLOCKER_REMINDER: "Blocker still open",
  BLOCKER_ESCALATION: "Blocker escalated",
  REPORT_SUBMITTED: "Weekly report to review",
  REPORT_CHANGES_REQUESTED: "Changes requested",
  REPORT_APPROVED: "Weekly report approved",
};

/** Compact "Needs attention" surface: a badge that opens an inbox. */
export function RemindersPanel({
  reminders,
  workspaceId,
  identity,
  devRole,
}: {
  reminders: Reminder[];
  workspaceId: string;
  identity: Identity;
  devRole: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const openItems = reminders.filter((r) => r.status === "OPEN");

  const ack = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await acknowledgeReminder(workspaceId, identity, devRole, id);
      // the reminder.updated WS event will move it out of the open list
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="reminders">
      <button
        className={`reminders-badge${openItems.length > 0 ? " has-items" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        Needs attention
        <span className="count">{openItems.length}</span>
      </button>

      {open && (
        <div className="reminders-drop">
          {err && <div className="banner error">{err}</div>}
          {openItems.length === 0 && <p className="meta">Nothing needs your attention.</p>}
          {openItems.map((r) => (
            <div key={r.id} className="reminder-item">
              <div className="reminder-head">
                <span className={`badge type-${r.type}`}>{LABEL[r.type] ?? r.type}</span>
                <span className="meta">
                  for {r.recipientRole} · {timeAgo(r.createdAt)}
                </span>
              </div>
              <div className="reminder-msg">{r.message}</div>
              <div className="reminder-foot meta">
                {r.entityType.toLowerCase()} {r.entityId.slice(0, 8)}
                <button disabled={busy === r.id} onClick={() => ack(r.id)}>
                  {busy === r.id ? "…" : "Acknowledge"}
                </button>
              </div>
            </div>
          ))}
          {reminders.some((r) => r.status === "ACKNOWLEDGED") && (
            <p className="meta acked-note">
              {reminders.filter((r) => r.status === "ACKNOWLEDGED").length} acknowledged
            </p>
          )}
        </div>
      )}
    </div>
  );
}
