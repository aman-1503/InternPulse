import { useState, type ReactNode } from "react";
import type { MeUser, Membership } from "../auth/types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { cn } from "../ui/primitives";

export function AppShell({
  user,
  memberships,
  activeHash,
  currentWorkspaceId,
  children,
}: {
  user: MeUser;
  memberships: Membership[];
  activeHash: string;
  currentWorkspaceId?: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar user={user} memberships={memberships} activeHash={activeHash} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar user={user} memberships={memberships} activeHash={activeHash} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className={cn("flex min-w-0 flex-1 flex-col")}>
        <Topbar user={user} memberships={memberships} currentWorkspaceId={currentWorkspaceId} onMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
