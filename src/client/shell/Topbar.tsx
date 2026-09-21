import type { MeUser, Membership } from "../auth/types";
import { ProfileMenu } from "./ProfileMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { btn, cn } from "../ui/primitives";
import { MenuIcon } from "../ui/icons";

export function Topbar({
  user,
  memberships,
  currentWorkspaceId,
  onMenu,
}: {
  user: MeUser;
  memberships: Membership[];
  currentWorkspaceId?: string;
  onMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
      <button className={cn(btn("ghost"), "md:hidden")} aria-label="Open menu" onClick={onMenu}>
        <MenuIcon />
      </button>
      <WorkspaceSwitcher memberships={memberships} currentWorkspaceId={currentWorkspaceId} />
      <div className="flex-1" />
      <ProfileMenu user={user} />
    </header>
  );
}
