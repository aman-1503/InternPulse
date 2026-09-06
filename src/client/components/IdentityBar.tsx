import type { Role } from "../../shared/protocol";
import { SEEDED_IDENTITIES, type DemoIdentity } from "../identity";

/**
 * DEV/DEMO identity switcher. Lets you become one of the seeded users (so D1
 * resolves a real role) or a random guest with a chosen dev role. Not auth.
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
    <header className="identity-bar">
      <strong className="brand" onClick={() => onNavigate("#/overview")}>
        InternPulse
      </strong>

      <nav className="topnav">
        <button className={view === "overview" ? "active" : ""} onClick={() => onNavigate("#/overview")}>
          Manager overview
        </button>
        <button
          className={view === "workspace" ? "active" : ""}
          onClick={() => onNavigate("#/w/demo")}
        >
          Workspace
        </button>
      </nav>

      <div className="spacer" />

      <label className="dev-only" title="DEV ONLY — not authentication">
        <span>DEMO identity</span>
        <select
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
        <label className="dev-only">
          <span>dev role</span>
          <select value={devRole} onChange={(e) => setDevRole(e.target.value as Role)}>
            <option value="intern">intern</option>
            <option value="mentor">mentor</option>
            <option value="manager">manager</option>
          </select>
        </label>
      )}

      <span className="whoami meta">
        {identity.displayName}
        {isSeeded ? " · role from D1" : ` · dev:${devRole}`}
      </span>
    </header>
  );
}
