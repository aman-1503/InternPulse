import type { ActivityEntry } from "../../../shared/protocol";
import type { WorkspaceState } from "../../lib/useWorkspace";
import { timeAgo } from "../../lib/format";
import { card, meta, sectionTitle } from "../../ui/primitives";

const VERB: Record<ActivityEntry["type"], string> = {
  "task.created": "created task",
  "task.moved": "moved task",
  "task.completed": "completed task",
  "task.deleted": "deleted task",
  "task.priority_changed": "changed priority of task",
  "blocker.raised": "raised a blocker",
  "blocker.commented": "commented on a blocker",
  "blocker.resolution_requested": "requested resolution of a blocker",
  "blocker.resolved": "resolved a blocker",
  "blocker.escalated": "escalated a blocker",
  "update.posted": "posted an update",
  "feedback.posted": "posted feedback",
  "weekly.manager_override": "overrode a weekly review",
  "workspace.member_added": "added a workspace member",
};

function describe(a: ActivityEntry): string {
  const meta = a.metadata ?? {};
  const title = typeof meta.title === "string" ? ` "${meta.title}"` : "";
  const status = typeof meta.status === "string" ? ` → ${meta.status}` : "";
  return `${VERB[a.type] ?? a.type}${title}${status}`;
}

export function ActivityTab({ state }: { state: WorkspaceState }) {
  return (
    <section className={card}>
      <h3 className={sectionTitle}>Activity</h3>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {state.activity.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-1.5">
            <span className={meta}>{timeAgo(a.createdAt)}</span>
            <strong>{a.actorName}</strong> {describe(a)}
          </li>
        ))}
        {state.activity.length === 0 && <li className={meta}>No activity yet.</li>}
      </ul>
    </section>
  );
}
