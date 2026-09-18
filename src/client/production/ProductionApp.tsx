import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { AuthGate } from "../auth/AuthGate";
import { deriveOnboardingStage } from "../auth/decisions";
import type { Membership } from "../auth/types";
import { parseProductionHash, type ProductionRoute } from "../router";
import { AppShell } from "../shell/AppShell";
import { RoleHome } from "../home/RoleHome";
import { MentionsPage } from "../home/MentionsPage";
import { WeeklyReviewsPage } from "../home/WeeklyReviewsPage";
import { Onboarding } from "../onboarding/Onboarding";
import { InvitationsScreen } from "../onboarding/InvitationsScreen";
import { CreateWorkspaceForm } from "../onboarding/CreateWorkspaceForm";
import { SettingsPage } from "../settings/SettingsPage";
import { AdminPage } from "../admin/AdminPage";
import { WorkspaceView } from "../workspace/WorkspaceView";
import { EmptyState } from "../ui/states";

function useProductionRoute(): ProductionRoute {
  const [route, setRoute] = useState<ProductionRoute>(() => parseProductionHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseProductionHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function AuthenticatedApp() {
  const { state } = useAuth();
  const route = useProductionRoute();
  if (state.status !== "authenticated") return null; // AuthGate guarantees this never renders otherwise
  const { user, memberships, pendingInvitations } = state;

  // A direct workspace/admin/settings/create-workspace link should work even
  // before the onboarding-stage decision would otherwise apply (e.g. a
  // mentor with existing memberships opening the create-workspace form to
  // start a second workspace) — onboarding gating only applies at the root.
  if (route.view === "workspace") {
    return (
      <AppShell user={user} memberships={memberships} activeHash={window.location.hash} currentWorkspaceId={route.workspaceId}>
        <WorkspaceViewLookup workspaceId={route.workspaceId} tab={route.tab} memberships={memberships} />
      </AppShell>
    );
  }
  if (route.view === "create-workspace") {
    return (
      <AppShell user={user} memberships={memberships} activeHash={window.location.hash}>
        <CreateWorkspaceForm />
      </AppShell>
    );
  }
  if (route.view === "settings") {
    return (
      <AppShell user={user} memberships={memberships} activeHash={window.location.hash}>
        <SettingsPage user={user} />
      </AppShell>
    );
  }
  if (route.view === "admin") {
    if (!user.isAdmin) {
      return (
        <AppShell user={user} memberships={memberships} activeHash={window.location.hash}>
          <div className="p-6">
            <EmptyState title="Admin access required" description="Only a platform admin can view this page." />
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell user={user} memberships={memberships} activeHash={window.location.hash}>
        <AdminPage />
      </AppShell>
    );
  }

  const stage = deriveOnboardingStage({ memberships, pendingInvitations });
  if (route.view === "onboarding" || (route.view === "home" && stage === "onboarding")) {
    return <Onboarding />;
  }
  if (route.view === "invitations" || (route.view === "home" && stage === "invitations")) {
    return <InvitationsScreen invitations={pendingInvitations} />;
  }

  const activeHash = window.location.hash || "#/home";
  if (activeHash === "#/mentions") {
    return (
      <AppShell user={user} memberships={memberships} activeHash={activeHash}>
        <MentionsPage memberships={memberships} />
      </AppShell>
    );
  }
  if (activeHash === "#/weekly") {
    return (
      <AppShell user={user} memberships={memberships} activeHash={activeHash}>
        <WeeklyReviewsPage memberships={memberships} />
      </AppShell>
    );
  }

  return (
    <AppShell user={user} memberships={memberships} activeHash={activeHash}>
      <RoleHome user={user} memberships={memberships} />
    </AppShell>
  );
}

function WorkspaceViewLookup({
  workspaceId,
  tab,
  memberships,
}: {
  workspaceId: string;
  tab?: string;
  memberships: Membership[];
}) {
  const membership = memberships.find((m) => m.workspaceId === workspaceId);
  return (
    <WorkspaceView
      key={workspaceId}
      workspaceId={workspaceId}
      urlTab={tab}
      workspaceName={membership?.workspaceName}
      mode={{ kind: "production" }}
      onBack={() => (window.location.hash = "#/home")}
    />
  );
}

/** Root of the Access-authenticated production experience. */
export function ProductionApp() {
  return (
    <AuthProvider>
      <AuthGate>
        <AuthenticatedApp />
      </AuthGate>
    </AuthProvider>
  );
}
