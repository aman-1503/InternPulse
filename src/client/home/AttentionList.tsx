import { timeAgo } from "../lib/format";
import { workspaceHash } from "../router";
import { badge, badgeTones, card, cn, meta, metaXs, sectionTitle } from "../ui/primitives";
import type { AttentionRow } from "./attentionGroups";
import { REASON_LABEL } from "./attentionGroups";

const CRITICAL_REASONS = new Set(["ESCALATION", "BLOCKER_UNRESOLVED_TOO_LONG", "URGENT_TASK_STILL_BLOCKED"]);

const NAV_TAB_SLUG: Record<AttentionRow["item"]["navigate"]["tab"], string> = {
  overview: "overview",
  board: "board",
  blockers: "blockers",
  feedback: "feedback",
  weekly: "weekly",
  activity: "activity",
};

export function AttentionList({
  title,
  rows,
  emptyText,
  showWorkspace = true,
}: {
  title: string;
  rows: AttentionRow[];
  emptyText: string;
  showWorkspace?: boolean;
}) {
  return (
    <section className={cn(card, "flex flex-col gap-3")}>
      <div className="flex items-center justify-between">
        <h2 className={sectionTitle}>{title}</h2>
        {rows.length > 0 && <span className={badge(badgeTones.danger)}>{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <p className={cn(meta, "py-1")}>{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const critical = CRITICAL_REASONS.has(row.item.reason);
            return (
              <li key={row.item.id}>
                <a
                  href={workspaceHash(row.workspaceId, NAV_TAB_SLUG[row.item.navigate.tab])}
                  className={cn(
                    "block rounded-lg border p-3 text-sm transition-colors hover:border-accent hover:bg-accent-muted/40",
                    critical ? "border-danger/40 bg-danger-muted/30" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-text">
                      {critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />}
                      {row.item.title}
                    </span>
                    <span className={metaXs}>{timeAgo(row.item.createdAt)}</span>
                  </div>
                  <p className={cn(meta, "mt-0.5")}>{row.item.message}</p>
                  <p className={cn(metaXs, "mt-1")}>
                    {REASON_LABEL[row.item.reason]}
                    {showWorkspace && <> · {row.workspaceName}</>}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
