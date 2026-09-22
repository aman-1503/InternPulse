import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "../identity";
import { IdentityBar } from "../components/IdentityBar";
import { ManagerOverview } from "../components/ManagerOverview";
import { WorkspaceView } from "../workspace/WorkspaceView";
import { navigate } from "../router";

type DemoRoute = { view: "overview" } | { view: "workspace"; workspaceId: string; tab?: string };

function parseDemoHash(hash: string): DemoRoute {
  const m = hash.match(/^#\/demo\/w\/([a-zA-Z0-9_-]{1,64})(?:\/([a-z]+))?$/);
  if (m) return { view: "workspace", workspaceId: m[1], tab: m[2] };
  return { view: "overview" };
}

/**
 * The pre-existing demo experience — Alice/Mia/Jordan identity switching,
 * sample data only. Structurally isolated from the production app: nothing
 * here is imported by src/client/production/*, and every API call goes
 * through /api/demo/* (see lib/workspaceApi.ts), which the Worker scopes to
 * is_demo=1 workspaces only.
 */
export function DemoApp() {
  const { identity, setIdentity, devRole, setDevRole, isSeeded, newGuest } = useIdentity();
  const [route, setRoute] = useState<DemoRoute>(() => parseDemoHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseDemoHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash.startsWith("#/demo")) navigate("#/demo");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goto = useCallback((hash: string) => navigate(hash), []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-text">
      <IdentityBar
        identity={identity}
        setIdentity={setIdentity}
        devRole={devRole}
        setDevRole={setDevRole}
        isSeeded={isSeeded}
        newGuest={newGuest}
        view={route.view}
        onNavigate={goto}
      />

      {route.view === "overview" ? (
        <ManagerOverview identity={identity} devRole={devRole} onOpenWorkspace={(id) => goto(`#/demo/w/${id}`)} />
      ) : (
        <WorkspaceView
          key={`${route.workspaceId}:${identity.userId}:${isSeeded ? "seed" : devRole}`}
          workspaceId={route.workspaceId}
          urlTab={route.tab}
          mode={{ kind: "demo", userId: identity.userId, displayName: identity.displayName, devRole }}
          demoBadge
          onBack={() => goto("#/demo")}
        />
      )}
    </div>
  );
}
