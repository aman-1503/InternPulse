import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "./identity";
import { IdentityBar } from "./components/IdentityBar";
import { ManagerOverview } from "./components/ManagerOverview";
import { Workspace } from "./components/Workspace";

type Route = { view: "overview" } | { view: "workspace"; workspaceId: string };

function parseHash(hash: string): Route {
  const m = hash.match(/^#\/w\/([a-zA-Z0-9_-]{1,64})$/);
  if (m) return { view: "workspace", workspaceId: m[1] };
  return { view: "overview" };
}

export function App() {
  const { identity, setIdentity, devRole, setDevRole, isSeeded, newGuest } = useIdentity();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) window.location.hash = "#/overview";
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  return (
    <div className="app">
      <IdentityBar
        identity={identity}
        setIdentity={setIdentity}
        devRole={devRole}
        setDevRole={setDevRole}
        isSeeded={isSeeded}
        newGuest={newGuest}
        view={route.view}
        onNavigate={navigate}
      />

      {route.view === "overview" ? (
        <ManagerOverview
          identity={identity}
          devRole={devRole}
          onOpenWorkspace={(id) => navigate(`#/w/${id}`)}
        />
      ) : (
        <Workspace
          key={`${route.workspaceId}:${identity.userId}:${isSeeded ? "seed" : devRole}`}
          workspaceId={route.workspaceId}
          identity={identity}
          devRole={devRole}
        />
      )}
    </div>
  );
}
