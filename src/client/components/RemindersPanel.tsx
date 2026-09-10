import { useState } from "react";
import type { AttentionItem, Reminder } from "../../shared/protocol";
import { timeAgo } from "../lib/format";

interface Identity {
  userId: string;
  displayName: string;
}

const NAV_TO_TAB: Record<AttentionItem["navigate"]["tab"], string> = {
  overview: "Overview",
  board: "Board",
  blockers: "Blockers",
  feedback: "Feedback",
  weekly: "Weekly",
  activity: "Activity",
};

/**
 * Role-curated "Needs attention" surface. Every item is re-derived from
 * current WorkspaceDO state (see worker/attention.ts) — nothing here is a
 * second, independently-stale copy, so an item simply stops appearing once
 * the underlying condition (e.g. a blocker resolving) is gone.
 */
export function RemindersPanel({
  items,
  reminders,
  onNavigate,
}: {
  items: AttentionItem[];
  reminders: Reminder[];
  workspaceId: string;
  identity: Identity;
  devRole: string;
  onNavigate: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  void reminders; // raw workflow reminders are folded into `items`; kept for callers still reading the field

  return (
    <div className="reminders">
      <button
        className={`reminders-badge${items.length > 0 ? " has-items" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        Needs attention
        <span className="count">{items.length}</span>
      </button>

      {open && (
        <div className="reminders-drop">
          {items.length === 0 && <p className="meta">Nothing needs your attention right now.</p>}
          {items.map((it) => (
            <button
              key={it.id}
              className="reminder-item reminder-item-clickable"
              onClick={() => {
                onNavigate(NAV_TO_TAB[it.navigate.tab] ?? "Overview");
                setOpen(false);
              }}
            >
              <div className="reminder-head">
                <span className={`badge type-${it.reason}`}>{it.title}</span>
                <span className="meta">{timeAgo(it.createdAt)}</span>
              </div>
              <div className="reminder-msg">{it.message}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
