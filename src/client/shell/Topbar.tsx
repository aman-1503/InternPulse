import type { MeUser, Membership } from "../auth/types";
import { ProfileMenu } from "./ProfileMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { btn } from "../ui/primitives";

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
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <button className={btn("ghost") + " md:hidden"} aria-label="Open menu" onClick={onMenu}>
        ☰
      </button>
      <WorkspaceSwitcher memberships={memberships} currentWorkspaceId={currentWorkspaceId} />
      <div className="flex-1" />
      <ProfileMenu user={user} />
    </header>
  );
}
