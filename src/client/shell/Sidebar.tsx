import type { ReactNode } from "react";
import type { MeUser, Membership } from "../auth/types";
import { workspaceHash } from "../router";
import { cn, meta } from "../ui/primitives";

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
        active ? "bg-accent-muted text-accent" : "text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      {children}
    </a>
  );
}

export function Sidebar({
  user,
  memberships,
  activeHash,
  onNavigate,
}: {
  user: MeUser;
  memberships: Membership[];
  activeHash: string;
  onNavigate?: () => void;
}) {
  const primary = memberships[0];
  const roleSectionLabel = memberships.some((m) => m.role === "manager")
    ? "Portfolio"
    : memberships.some((m) => m.role === "mentor")
      ? "My interns"
      : "My work";

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3" onClick={onNavigate}>
      <div className="mb-2 px-2 text-base font-semibold text-text">InternPulse</div>
      <NavLink href="#/home" active={activeHash === "#/home" || activeHash === ""}>
        Home
      </NavLink>
      <NavLink href="#/home" active={false}>
        {roleSectionLabel}
      </NavLink>
      <NavLink href="#/mentions" active={activeHash === "#/mentions"}>
        Mentions
      </NavLink>
      <NavLink href="#/weekly" active={activeHash === "#/weekly"}>
        Weekly Reviews
      </NavLink>
      {primary && (
        <>
          <NavLink href={workspaceHash(primary.workspaceId, "attachments")} active={false}>
            Files
          </NavLink>
          <NavLink href={workspaceHash(primary.workspaceId, "agent")} active={false}>
            Progress Agent
          </NavLink>
        </>
      )}
      <div className="my-2 border-t border-border" />
      <NavLink href="#/settings" active={activeHash === "#/settings"}>
        Settings
      </NavLink>
      {user.isAdmin && (
        <NavLink href="#/admin" active={activeHash === "#/admin"}>
          Admin
        </NavLink>
      )}
      {memberships.length > 0 && (
        <div className="mt-auto px-2 pt-3">
          <p className={meta}>{memberships.length} workspace(s)</p>
        </div>
      )}
    </nav>
  );
}
