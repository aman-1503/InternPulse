import { useState } from "react";
import type { Role, WorkspaceMember } from "../../shared/protocol";

/** Small mentor/manager-only "add a member" popover. Role constraints preserved server-side. */
export function AddMemberForm({
  workspaceId,
  identity,
  devRole,
  members,
}: {
  workspaceId: string;
  identity: { userId: string; displayName: string };
  devRole: string;
  members: WorkspaceMember[];
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("intern");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ userId: identity.userId, displayName: identity.displayName, devRole });
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/members?${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, email, role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setDisplayName("");
      setEmail("");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reminders">
      <button className="reminders-badge" onClick={() => setOpen((v) => !v)}>
        Members
        <span className="count">{members.length}</span>
      </button>
      {open && (
        <div className="reminders-drop">
          {error && <div className="banner error">{error}</div>}
          <ul className="list">
            {members.map((m) => (
              <li key={m.userId}>
                {m.displayName} <span className="meta">({m.role})</span>
              </li>
            ))}
          </ul>
          <div className="stack">
            <input placeholder="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="intern">intern</option>
              <option value="mentor">mentor</option>
              <option value="manager">manager</option>
            </select>
            <button className="primary" disabled={!displayName || !email || busy} onClick={submit}>
              {busy ? "Adding…" : "Add member"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
