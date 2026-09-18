import { useRef, useState } from "react";
import type { Role, WorkspaceMember } from "../../shared/protocol";
import { identityQuery, withQuery, workspaceBase, type WorkspaceMode } from "../lib/workspaceApi";
import { btn, card, cn, input, meta, row, select, stack } from "../ui/primitives";
import { Banner } from "../ui/states";
import { Popover } from "../ui/Popover";

/**
 * Demo-only "add a member" popover — instant membership with no invitation
 * step, matching the pre-existing demo sandbox behavior. Production member
 * management goes through the invitation flow instead (see
 * workspace/WorkspaceSettings.tsx) — this component is only ever rendered
 * when `mode.kind === "demo"`.
 */
export function AddMemberForm({
  workspaceId,
  mode,
  members,
}: {
  workspaceId: string;
  mode: WorkspaceMode;
  members: WorkspaceMember[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("intern");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withQuery(`${workspaceBase(workspaceId, mode)}/members`, identityQuery(mode)), {
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
    <>
      <button ref={triggerRef} className={btn("default")} onClick={() => setOpen((v) => !v)}>
        Members <span className="ml-1 text-muted">{members.length}</span>
      </button>
      <Popover open={open} triggerRef={triggerRef} onClose={() => setOpen(false)} className={cn(card, "w-72")}>
        {error && (
          <div className="mb-2">
            <Banner tone="danger">{error}</Banner>
          </div>
        )}
        <ul className="mb-2 space-y-1 text-sm">
          {members.map((m) => (
            <li key={m.userId}>
              {m.displayName} <span className={meta}>({m.role})</span>
            </li>
          ))}
        </ul>
        <div className={stack}>
          <input className={input} placeholder="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <input className={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className={select} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="intern">intern</option>
            <option value="mentor">mentor</option>
            <option value="manager">manager</option>
          </select>
          <button className={cn(btn("primary"), row)} disabled={!displayName || !email || busy} onClick={submit}>
            {busy ? "Adding…" : "Add member"}
          </button>
        </div>
      </Popover>
    </>
  );
}
