import type { ReactNode } from "react";
import type { MeUser, Membership } from "../auth/types";
import { workspaceHash } from "../router";
import { cn, metaXs } from "../ui/primitives";
import { AtIcon, ClipboardIcon, FileIcon, GearIcon, HomeIcon, ShieldIcon, SparkleIcon } from "../ui/icons";

function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent-muted text-accent before:absolute before:-left-1 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
          : "text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      {icon}
      {children}
    </a>
  );
}

function NavGroupLabel({ children }: { children: ReactNode }) {
  return <div className={cn(metaXs, "px-3 pb-1 pt-3 font-semibold uppercase tracking-wider")}>{children}</div>;
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
  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-0.5 border-r border-border bg-surface p-3" onClick={onNavigate}>
      <div className="mb-3 flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">IP</span>
        <span className="text-base font-semibold tracking-tight text-text">InternPulse</span>
      </div>

      <NavLink href="#/home" active={activeHash === "#/home" || activeHash === ""} icon={<HomeIcon />}>
        Home — {roleSectionLabel}
      </NavLink>
      <NavLink href="#/mentions" active={activeHash === "#/mentions"} icon={<AtIcon />}>
        Mentions
      </NavLink>
      <NavLink href="#/weekly" active={activeHash === "#/weekly"} icon={<ClipboardIcon />}>
        Weekly Reviews
      </NavLink>

      {primary && (
        <>
          <NavGroupLabel>Workspace</NavGroupLabel>
          <NavLink href={workspaceHash(primary.workspaceId, "attachments")} active={false} icon={<FileIcon />}>
            Files
          </NavLink>
          <NavLink href={workspaceHash(primary.workspaceId, "agent")} active={false} icon={<SparkleIcon />}>
            Progress Agent
          </NavLink>
        </>
      )}

      <div className="mt-auto flex flex-col gap-0.5 pt-3">
        <div className={cn("mb-1", "border-t border-border")} />
        <NavLink href="#/settings" active={activeHash === "#/settings"} icon={<GearIcon />}>
          Settings
        </NavLink>
        {user.isAdmin && (
          <NavLink href="#/admin" active={activeHash === "#/admin"} icon={<ShieldIcon />}>
            Admin
          </NavLink>
        )}
        <div className="mt-2 flex items-center gap-2 rounded-md px-2 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-accent">
            {initial}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-medium text-text">{user.displayName}</p>
            <p className={metaXs}>{memberships.length} workspace{memberships.length === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
