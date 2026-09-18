import { useState } from "react";
import type { AttentionItem } from "../../shared/protocol";
import { timeAgo } from "../lib/format";
import { badge, badgeTones, btn, cn, meta } from "../ui/primitives";

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
  onNavigate,
}: {
  items: AttentionItem[];
  onNavigate: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className={cn(btn("default"), items.length > 0 && "border-danger/30 bg-danger-muted text-danger")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Needs attention
        {items.length > 0 && <span className={cn(badge(badgeTones.danger), "ml-1")}>{items.length}</span>}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[90vw] rounded-lg border border-border bg-surface p-2 shadow-lg">
          {items.length === 0 && <p className={cn(meta, "p-2")}>Nothing needs your attention right now.</p>}
          <ul className="flex flex-col gap-1">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  className="w-full rounded-md p-2 text-left hover:bg-surface-muted"
                  onClick={() => {
                    onNavigate(NAV_TO_TAB[it.navigate.tab] ?? "Overview");
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">{it.title}</span>
                    <span className={meta}>{timeAgo(it.createdAt)}</span>
                  </div>
                  <div className={cn(meta, "mt-0.5")}>{it.message}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
