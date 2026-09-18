import type { Role } from "../../shared/protocol";
import { SEEDED_IDENTITIES, type DemoIdentity } from "../identity";
import { cn, meta, select } from "../ui/primitives";

/**
 * DEV/DEMO identity switcher. Lets you become one of the seeded users (so D1
 * resolves a real role) or a random guest with a chosen dev role. Not auth —
 * only ever rendered inside the /demo experience, never in the production
 * app tree.
 */
export function IdentityBar({
  identity,
  setIdentity,
  devRole,
  setDevRole,
  isSeeded,
  newGuest,
  view,
  onNavigate,
}: {
  identity: DemoIdentity;
  setIdentity: (i: DemoIdentity) => void;
  devRole: Role;
  setDevRole: (r: Role) => void;
  isSeeded: boolean;
  newGuest: () => void;
  view: "overview" | "workspace";
  onNavigate: (hash: string) => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning-muted px-4 py-2">
      <strong className="cursor-pointer text-text" onClick={() => onNavigate("#/demo")}>
        InternPulse <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs font-semibold text-warning">DEMO MODE</span>
      </strong>

      <nav className="flex gap-1">
        <button
          className={cn("rounded-md px-2 py-1 text-sm", view === "overview" ? "bg-surface font-medium" : "text-muted hover:text-text")}
          onClick={() => onNavigate("#/demo")}
        >
          Manager overview
        </button>
        <button
          className={cn("rounded-md px-2 py-1 text-sm", view === "workspace" ? "bg-surface font-medium" : "text-muted hover:text-text")}
          onClick={() => onNavigate("#/demo/w/demo")}
        >
          Workspace
        </button>
      </nav>

      <div className="flex-1" />

      <label className="flex items-center gap-1.5 text-sm" title="DEV ONLY — not authentication">
        <span className={meta}>identity</span>
        <select
          className={cn(select, "w-auto py-1")}
          value={isSeeded ? identity.userId : "__guest__"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__guest__") newGuest();
            else {
              const s = SEEDED_IDENTITIES.find((x) => x.userId === v)!;
              setIdentity({ userId: s.userId, displayName: s.displayName });
            }
          }}
        >
          {SEEDED_IDENTITIES.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.displayName}
            </option>
          ))}
          <option value="__guest__">Guest (pick role →)</option>
        </select>
      </label>

      {!isSeeded && (
        <label className="flex items-center gap-1.5 text-sm">
          <span className={meta}>role</span>
          <select className={cn(select, "w-auto py-1")} value={devRole} onChange={(e) => setDevRole(e.target.value as Role)}>
            <option value="intern">intern</option>
            <option value="mentor">mentor</option>
            <option value="manager">manager</option>
          </select>
        </label>
      )}

      <span className={meta}>
        {identity.displayName}
        {isSeeded ? " · role from D1" : ` · dev:${devRole}`}
      </span>
    </header>
  );
}
