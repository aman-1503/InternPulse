import type { PresenceState } from "../../shared/protocol";
import type { SocketStatus } from "../lib/workspaceSocket";
import { RoleBadge } from "../ui/badges";
import { badge, badgeTones, meta } from "../ui/primitives";

const STATUS_TONE: Record<SocketStatus, keyof typeof badgeTones> = {
  connecting: "neutral",
  open: "success",
  closed: "warning",
  unauthorized: "danger",
};

export function PresenceBar({ presence, status }: { presence: PresenceState; status: SocketStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span data-testid="socket-status" className={badge(badgeTones[STATUS_TONE[status]])}>{status}</span>
      <span className={meta}>{presence.count} online</span>
      <span className="flex flex-wrap gap-1.5">
        {presence.members.map((m) => (
          <span key={m.userId} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
            {m.displayName}
            <RoleBadge role={m.role} />
          </span>
        ))}
      </span>
    </div>
  );
}
