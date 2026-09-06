import type { PresenceState, Role } from "../../shared/protocol";
import type { SocketStatus } from "../lib/workspaceSocket";

export function RoleBadge({ role }: { role: Role | null }) {
  return <span className={`badge role-${role ?? "none"}`}>{role ?? "observer"}</span>;
}

export function PresenceBar({
  presence,
  status,
}: {
  presence: PresenceState;
  status: SocketStatus;
}) {
  return (
    <div className="presence">
      <span className={`pill ${status}`}>{status}</span>
      <span className="meta">{presence.count} online</span>
      <span className="presence-members">
        {presence.members.map((m) => (
          <span key={m.userId} className="presence-chip">
            {m.displayName}
            <RoleBadge role={m.role} />
          </span>
        ))}
      </span>
    </div>
  );
}
