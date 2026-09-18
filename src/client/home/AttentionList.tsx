import { timeAgo } from "../lib/format";
import { workspaceHash } from "../router";
import { card, cn, meta, sectionTitle } from "../ui/primitives";
import type { AttentionRow } from "./attentionGroups";
import { REASON_LABEL } from "./attentionGroups";

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
        {rows.length > 0 && (
          <span className="rounded-full bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger">
            {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className={meta}>{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.item.id}>
              <a
                href={workspaceHash(row.workspaceId, NAV_TAB_SLUG[row.item.navigate.tab])}
                className="block rounded-lg border border-border p-3 text-sm hover:border-accent hover:bg-accent-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{row.item.title}</span>
                  <span className={meta}>{timeAgo(row.item.createdAt)}</span>
                </div>
                <p className={cn(meta, "mt-0.5")}>{row.item.message}</p>
                <p className="mt-1 text-xs text-muted">
                  {REASON_LABEL[row.item.reason]}
                  {showWorkspace && <> · {row.workspaceName}</>}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
